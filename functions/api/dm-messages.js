// functions/api/dm-messages.js — история и отправка сообщений в личной
// переписке между аккаунтами напрямую (вне персонажей). Проще, чем
// sms-messages.js: отправитель определяется самим тредом (в паре людей это
// всегда тот, кто не second_id), персонажи тут вообще ни при чём.

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status: status, headers: { "Content-Type": "application/json" } });
}

function isOwner(env, id) {
  if (!env.OWNER_ID || !id) return false;
  const ids = String(env.OWNER_ID).split(",").map(function (s) { return s.trim(); }).filter(Boolean);
  return ids.indexOf(String(id)) !== -1;
}

async function resolveThread(env, threadId, userId) {
  const row = await env.DB.prepare("SELECT id, user_low_id, user_high_id FROM dm_threads WHERE id = ?").bind(threadId).first();
  if (!row) return null;
  if (String(row.user_low_id) !== String(userId) && String(row.user_high_id) !== String(userId)) return null;
  const otherId = String(row.user_low_id) === String(userId) ? row.user_high_id : row.user_low_id;
  return { otherId: otherId };
}

// Считаем "в сети" по свежему присутствию (см. _middleware.js) - если человек
// сейчас активен в приложении, не шлём ему уведомление о том же сообщении,
// которое он и так вот-вот увидит.
const ONLINE_WINDOW_MS = 60000;

async function notifyRecipient(env, threadId, recipientId, messageId) {
  if (!isOwner(env, recipientId)) return;
  try {
    const readRow = await env.DB.prepare(
      "SELECT last_read_message_id, last_notified_message_id FROM dm_reads WHERE thread_id = ? AND user_id = ?"
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
      body: JSON.stringify({ chat_id: recipientId, text: "У вас новое личное сообщение." }),
    });
    if (!resp.ok) {
      console.log("Telegram sendMessage отказал (" + resp.status + ") для " + recipientId + ":", await resp.text());
    }

    await env.DB.prepare(
      "INSERT INTO dm_reads (thread_id, user_id, last_read_message_id, last_notified_message_id) VALUES (?, ?, 0, ?) " +
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
    "SELECT id, sender_user_id, text, created_at, edited_at FROM dm_messages " +
      "WHERE thread_id = ? AND (id > ? OR (edited_at IS NOT NULL AND edited_at > ?)) ORDER BY id ASC LIMIT 200"
  ).bind(threadId, afterId, afterEdit).all();

  const otherRead = await env.DB.prepare(
    "SELECT MIN(last_read_message_id) AS v FROM dm_reads WHERE thread_id = ? AND user_id != ?"
  ).bind(threadId, String(userId)).first();

  return json({ messages: results || [], other_read_id: (otherRead && otherRead.v != null) ? otherRead.v : 0 });
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
  if (!text) return json({ error: "Пустое сообщение." }, 400);
  if (text.length > 4000) return json({ error: "Слишком длинное сообщение." }, 400);

  let message = null;
  try {
    message = await env.DB.prepare(
      "INSERT INTO dm_messages (thread_id, sender_user_id, text) VALUES (?, ?, ?) " +
        "RETURNING id, sender_user_id, text, created_at, edited_at"
    ).bind(threadId, String(userId), text).first();
  } catch (e) {
    console.log("Ошибка отправки личного сообщения:", e.message);
    return json({ error: "Не удалось отправить сообщение." }, 500);
  }

  context.waitUntil(notifyRecipient(env, threadId, access.otherId, message.id));

  return json({ message: message });
}
