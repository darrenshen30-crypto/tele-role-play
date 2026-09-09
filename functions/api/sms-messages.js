// functions/api/sms-messages.js — история и отправка сообщений внутри одной
// SMS-переписки. Персонаж отправителя определяется самим тредом (в паре
// персонажей это всегда тот, что принадлежит текущему пользователю), поэтому
// его не нужно указывать в запросе, в отличие от чата локации.

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status: status, headers: { "Content-Type": "application/json" } });
}

function isOwner(env, id) {
  if (!env.OWNER_ID || !id) return false;
  const ids = String(env.OWNER_ID).split(",").map(function (s) { return s.trim(); }).filter(Boolean);
  return ids.indexOf(String(id)) !== -1;
}

async function resolveThread(env, threadId, userId) {
  const row = await env.DB.prepare(
    "SELECT cl.id AS low_id, cl.owner_id AS low_owner, cl.name AS low_name, cl.avatar_file_id AS low_avatar, " +
      "ch.id AS high_id, ch.owner_id AS high_owner, ch.name AS high_name, ch.avatar_file_id AS high_avatar " +
      "FROM sms_threads t JOIN characters cl ON cl.id = t.char_low_id JOIN characters ch ON ch.id = t.char_high_id " +
      "WHERE t.id = ?"
  ).bind(threadId).first();
  if (!row) return null;
  const low = { id: row.low_id, owner_id: row.low_owner, name: row.low_name, avatar_file_id: row.low_avatar };
  const high = { id: row.high_id, owner_id: row.high_owner, name: row.high_name, avatar_file_id: row.high_avatar };
  if (String(low.owner_id) === String(userId)) return { mine: low, other: high };
  if (String(high.owner_id) === String(userId)) return { mine: high, other: low };
  return null;
}

// Считаем "в сети" по свежему присутствию (см. _middleware.js) - если человек
// сейчас активен в приложении, не шлём ему уведомление о том же сообщении,
// которое он и так вот-вот увидит.
const ONLINE_WINDOW_MS = 60000;

async function notifyRecipient(env, threadId, recipientId, messageId) {
  if (!isOwner(env, recipientId)) return;
  try {
    const readRow = await env.DB.prepare(
      "SELECT last_read_message_id, last_notified_message_id FROM sms_reads WHERE thread_id = ? AND user_id = ?"
    ).bind(threadId, String(recipientId)).first();
    const lastRead = readRow ? readRow.last_read_message_id : 0;
    const lastNotified = readRow ? readRow.last_notified_message_id : 0;
    if (messageId <= lastRead || messageId <= lastNotified) return;

    const presence = await env.DB.prepare("SELECT last_seen FROM user_presence WHERE user_id = ?").bind(String(recipientId)).first();
    const lastSeenMs = presence && presence.last_seen ? new Date(presence.last_seen).getTime() : 0;
    if (Date.now() - lastSeenMs < ONLINE_WINDOW_MS) return;

    const resp = await fetch("https://api.telegram.org/bot" + env.BOT_TOKEN + "/sendMessage", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: recipientId, text: "У вас новое непрочитанное сообщение." }),
    });
    if (!resp.ok) {
      console.log("Telegram sendMessage отказал (" + resp.status + ") для " + recipientId + ":", await resp.text());
    }

    await env.DB.prepare(
      "INSERT INTO sms_reads (thread_id, user_id, last_read_message_id, last_notified_message_id) VALUES (?, ?, 0, ?) " +
        "ON CONFLICT(thread_id, user_id) DO UPDATE SET last_notified_message_id = excluded.last_notified_message_id"
    ).bind(threadId, String(recipientId), messageId).run();
  } catch (e) {
    console.log("Ошибка уведомления получателя " + recipientId + ":", e.message);
  }
}

export async function onRequestGet(context) {
  const env = context.env;
  const userId = context.data && context.data.tgUserId;
  if (!isOwner(env, userId)) return json({ error: "Нет доступа." }, 403);

  const params = new URL(context.request.url).searchParams;
  const threadId = params.get("thread_id");
  const afterId = params.get("after_id") || "0";
  const afterEdit = params.get("after_edit") || "";
  if (!threadId) return json({ error: "Не указана переписка." }, 400);

  const access = await resolveThread(env, threadId, userId);
  if (!access) return json({ error: "Нет доступа к этой переписке." }, 403);

  const { results } = await env.DB.prepare(
    "SELECT cm.id, cm.sender_user_id, cm.character_name, cm.character_avatar_file_id, cm.text, cm.created_at, cm.edited_at, cm.reply_to_id, cm.photo_file_id, " +
      "rm.text AS reply_text, rm.character_name AS reply_character_name " +
      "FROM sms_messages cm LEFT JOIN sms_messages rm ON rm.id = cm.reply_to_id " +
      "WHERE cm.thread_id = ? AND (cm.id > ? OR (cm.edited_at IS NOT NULL AND cm.edited_at > ?)) ORDER BY cm.id ASC LIMIT 200"
  ).bind(threadId, afterId, afterEdit).all();

  const messages = (results || []).map(function (row) {
    const message = {
      id: row.id, sender_user_id: row.sender_user_id, character_name: row.character_name,
      character_avatar_file_id: row.character_avatar_file_id, text: row.text,
      created_at: row.created_at, edited_at: row.edited_at, photo_file_id: row.photo_file_id,
    };
    if (row.reply_to_id) {
      message.reply = { id: row.reply_to_id, text: row.reply_text, character_name: row.reply_character_name };
    }
    return message;
  });

  const otherRead = await env.DB.prepare(
    "SELECT MIN(last_read_message_id) AS v FROM sms_reads WHERE thread_id = ? AND user_id != ?"
  ).bind(threadId, String(userId)).first();

  return json({ messages: messages, other_read_id: (otherRead && otherRead.v != null) ? otherRead.v : 0 });
}

export async function onRequestPost(context) {
  const env = context.env;
  const userId = context.data && context.data.tgUserId;
  if (!isOwner(env, userId)) return json({ error: "Нет доступа." }, 403);

  const threadId = new URL(context.request.url).searchParams.get("thread_id");
  if (!threadId) return json({ error: "Не указана переписка." }, 400);

  const access = await resolveThread(env, threadId, userId);
  if (!access) return json({ error: "Нет доступа к этой переписке." }, 403);

  const body = await context.request.json();
  const text = (body.text || "").trim();
  const photoFileId = body.photo_file_id || null;
  if (!text && !photoFileId) return json({ error: "Пустое сообщение." }, 400);
  if (text.length > 4000) return json({ error: "Слишком длинное сообщение." }, 400);

  let replyTo = null;
  if (body.reply_to_id) {
    replyTo = await env.DB.prepare(
      "SELECT id, text, character_name FROM sms_messages WHERE id = ? AND thread_id = ?"
    ).bind(Number(body.reply_to_id), threadId).first();
    if (!replyTo) return json({ error: "Сообщение для ответа не найдено." }, 400);
  }

  let message = null;
  try {
    message = await env.DB.prepare(
      "INSERT INTO sms_messages (thread_id, sender_user_id, character_id, character_name, character_avatar_file_id, text, reply_to_id, photo_file_id) " +
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?) " +
        "RETURNING id, sender_user_id, character_name, character_avatar_file_id, text, created_at, edited_at, reply_to_id, photo_file_id"
    ).bind(threadId, String(userId), access.mine.id, access.mine.name, access.mine.avatar_file_id, text, replyTo ? replyTo.id : null, photoFileId).first();
  } catch (e) {
    console.log("Ошибка отправки SMS:", e.message);
    return json({ error: "Не удалось отправить сообщение." }, 500);
  }
  if (replyTo) message.reply = { id: replyTo.id, text: replyTo.text, character_name: replyTo.character_name };

  context.waitUntil(notifyRecipient(env, threadId, access.other.owner_id, message.id));

  return json({ message: message });
}
