// functions/api/sms-threads.js — список личных переписок (по паре персонажей)
// и создание новой. Каждая пара персонажей - отдельный тред, как контакты
// в телефоне; направление не важно, поэтому храним пару id упорядоченной
// (char_low_id < char_high_id) и ищем/создаём по этой же паре.

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status: status, headers: { "Content-Type": "application/json" } });
}

function isOwner(env, id) {
  if (!env.OWNER_ID || !id) return false;
  const ids = String(env.OWNER_ID).split(",").map(function (s) { return s.trim(); }).filter(Boolean);
  return ids.indexOf(String(id)) !== -1;
}

export async function onRequestGet(context) {
  const env = context.env;
  const userId = context.data && context.data.tgUserId;
  if (!isOwner(env, userId)) return json({ error: "Нет доступа." }, 403);

  const { results } = await env.DB.prepare(
    "SELECT t.id, " +
      "cl.id AS low_id, cl.name AS low_name, cl.avatar_file_id AS low_avatar, cl.owner_id AS low_owner, " +
      "ch.id AS high_id, ch.name AS high_name, ch.avatar_file_id AS high_avatar, ch.owner_id AS high_owner, " +
      "lm.id AS last_message_id, lm.sender_user_id AS last_message_sender, lm.created_at AS last_message_at, " +
      "COALESCE(r.last_read_message_id, 0) AS last_read_message_id " +
      "FROM sms_threads t " +
      "JOIN characters cl ON cl.id = t.char_low_id " +
      "JOIN characters ch ON ch.id = t.char_high_id " +
      "LEFT JOIN (SELECT thread_id, MAX(id) AS id FROM sms_messages GROUP BY thread_id) lmid ON lmid.thread_id = t.id " +
      "LEFT JOIN sms_messages lm ON lm.id = lmid.id " +
      "LEFT JOIN sms_reads r ON r.thread_id = t.id AND r.user_id = ? " +
      "WHERE cl.owner_id = ? OR ch.owner_id = ? " +
      "ORDER BY COALESCE(lm.created_at, t.created_at) DESC"
  ).bind(String(userId), String(userId), String(userId)).all();

  const threads = (results || []).map(function (row) {
    const mine = String(row.low_owner) === String(userId)
      ? { id: row.low_id, name: row.low_name, avatar_file_id: row.low_avatar }
      : { id: row.high_id, name: row.high_name, avatar_file_id: row.high_avatar };
    const other = String(row.low_owner) === String(userId)
      ? { id: row.high_id, name: row.high_name, avatar_file_id: row.high_avatar }
      : { id: row.low_id, name: row.low_name, avatar_file_id: row.low_avatar };
    const unread = !!row.last_message_id &&
      String(row.last_message_sender) !== String(userId) &&
      row.last_message_id > row.last_read_message_id;
    return { id: row.id, my_character: mine, other_character: other, unread: unread };
  });

  return json({ threads: threads });
}

export async function onRequestPost(context) {
  const env = context.env;
  const userId = context.data && context.data.tgUserId;
  if (!isOwner(env, userId)) return json({ error: "Нет доступа." }, 403);

  const body = await context.request.json();
  const myId = Number(body.my_character_id);
  const otherId = Number(body.other_character_id);
  if (!myId || !otherId) return json({ error: "Выберите обоих персонажей." }, 400);

  const mine = await env.DB.prepare("SELECT id, owner_id, name, avatar_file_id FROM characters WHERE id = ?").bind(myId).first();
  const other = await env.DB.prepare("SELECT id, owner_id, name, avatar_file_id FROM characters WHERE id = ?").bind(otherId).first();
  if (!mine || String(mine.owner_id) !== String(userId)) return json({ error: "Это не ваш персонаж." }, 403);
  if (!other || String(other.owner_id) === String(userId)) return json({ error: "Выберите персонажа второго человека." }, 400);

  const low = Math.min(myId, otherId);
  const high = Math.max(myId, otherId);

  try {
    await env.DB.prepare("INSERT OR IGNORE INTO sms_threads (char_low_id, char_high_id) VALUES (?, ?)").bind(low, high).run();
  } catch (e) {
    console.log("Ошибка создания переписки:", e.message);
    return json({ error: "Не удалось создать переписку." }, 500);
  }

  const thread = await env.DB.prepare("SELECT id FROM sms_threads WHERE char_low_id = ? AND char_high_id = ?").bind(low, high).first();

  return json({
    thread_id: thread.id,
    my_character: { id: mine.id, name: mine.name, avatar_file_id: mine.avatar_file_id },
    other_character: { id: other.id, name: other.name, avatar_file_id: other.avatar_file_id },
  });
}
