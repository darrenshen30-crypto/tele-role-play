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
    "SELECT id, sender_user_id, character_name, character_avatar_file_id, text, created_at, edited_at FROM sms_messages " +
      "WHERE thread_id = ? AND (id > ? OR (edited_at IS NOT NULL AND edited_at > ?)) ORDER BY id ASC LIMIT 200"
  ).bind(threadId, afterId, afterEdit).all();

  const otherRead = await env.DB.prepare(
    "SELECT MIN(last_read_message_id) AS v FROM sms_reads WHERE thread_id = ? AND user_id != ?"
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
      "INSERT INTO sms_messages (thread_id, sender_user_id, character_id, character_name, character_avatar_file_id, text) " +
        "VALUES (?, ?, ?, ?, ?, ?) " +
        "RETURNING id, sender_user_id, character_name, character_avatar_file_id, text, created_at, edited_at"
    ).bind(threadId, String(userId), access.mine.id, access.mine.name, access.mine.avatar_file_id, text).first();
  } catch (e) {
    console.log("Ошибка отправки SMS:", e.message);
    return json({ error: "Не удалось отправить сообщение." }, 500);
  }
  return json({ message: message });
}
