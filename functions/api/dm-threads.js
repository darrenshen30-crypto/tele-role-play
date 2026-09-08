// functions/api/dm-threads.js — список личных переписок между аккаунтами
// напрямую (вне персонажей) и поиск/создание переписки с конкретным
// человеком. У каждой пары людей ровно один тред, поэтому "создание" на
// самом деле find-or-create - как sms_threads, но по паре user_id вместо
// пары character_id.

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status: status, headers: { "Content-Type": "application/json" } });
}

function isOwner(env, id) {
  if (!env.OWNER_ID || !id) return false;
  const ids = String(env.OWNER_ID).split(",").map(function (s) { return s.trim(); }).filter(Boolean);
  return ids.indexOf(String(id)) !== -1;
}

function profileFrom(row, prefix) {
  const id = row[prefix + "_id"];
  const name = row[prefix + "_display_name"] || row[prefix + "_name"] || ("Пользователь " + id);
  const avatarUrl = row[prefix + "_avatar_file_id"]
    ? "/api/tg-photo?file_id=" + encodeURIComponent(row[prefix + "_avatar_file_id"])
    : (row[prefix + "_photo_url"] || null);
  return { user_id: id, name: name, avatar_url: avatarUrl };
}

export async function onRequestGet(context) {
  const env = context.env;
  const userId = context.data && context.data.tgUserId;
  if (!isOwner(env, userId)) return json({ error: "Нет доступа." }, 403);

  const { results } = await env.DB.prepare(
    "SELECT t.id, " +
      "t.user_low_id AS low_id, lp.display_name AS low_display_name, lp.name AS low_name, lp.avatar_file_id AS low_avatar_file_id, lp.photo_url AS low_photo_url, " +
      "t.user_high_id AS high_id, hp.display_name AS high_display_name, hp.name AS high_name, hp.avatar_file_id AS high_avatar_file_id, hp.photo_url AS high_photo_url, " +
      "lm.id AS last_message_id, lm.sender_user_id AS last_message_sender, lm.created_at AS last_message_at, lm.text AS last_message_text, " +
      "COALESCE(r.last_read_message_id, 0) AS last_read_message_id " +
      "FROM dm_threads t " +
      "LEFT JOIN user_presence lp ON lp.user_id = t.user_low_id " +
      "LEFT JOIN user_presence hp ON hp.user_id = t.user_high_id " +
      "LEFT JOIN (SELECT thread_id, MAX(id) AS id FROM dm_messages GROUP BY thread_id) lmid ON lmid.thread_id = t.id " +
      "LEFT JOIN dm_messages lm ON lm.id = lmid.id " +
      "LEFT JOIN dm_reads r ON r.thread_id = t.id AND r.user_id = ? " +
      "WHERE t.user_low_id = ? OR t.user_high_id = ? " +
      "ORDER BY COALESCE(lm.created_at, t.created_at) DESC"
  ).bind(String(userId), String(userId), String(userId)).all();

  const threads = (results || []).map(function (row) {
    const otherPrefix = String(row.low_id) === String(userId) ? "high" : "low";
    const other = profileFrom(row, otherPrefix);
    const unread = !!row.last_message_id &&
      String(row.last_message_sender) !== String(userId) &&
      row.last_message_id > row.last_read_message_id;
    return {
      id: row.id,
      other: other,
      last_message_text: row.last_message_text || null,
      unread: unread,
    };
  });

  return json({ threads: threads });
}

export async function onRequestPost(context) {
  const env = context.env;
  const userId = context.data && context.data.tgUserId;
  if (!isOwner(env, userId)) return json({ error: "Нет доступа." }, 403);

  const body = await context.request.json();
  const otherId = body.other_user_id != null ? String(body.other_user_id) : "";
  if (!otherId) return json({ error: "Не указан собеседник." }, 400);
  if (otherId === String(userId)) return json({ error: "Нельзя написать самому себе." }, 400);
  if (!isOwner(env, otherId)) return json({ error: "Такого пользователя нет." }, 400);

  const a = Number(userId), b = Number(otherId);
  const lowId = String(Math.min(a, b));
  const highId = String(Math.max(a, b));

  try {
    await env.DB.prepare("INSERT OR IGNORE INTO dm_threads (user_low_id, user_high_id) VALUES (?, ?)").bind(lowId, highId).run();
  } catch (e) {
    console.log("Ошибка создания личной переписки:", e.message);
    return json({ error: "Не удалось начать переписку." }, 500);
  }

  const thread = await env.DB.prepare("SELECT id FROM dm_threads WHERE user_low_id = ? AND user_high_id = ?").bind(lowId, highId).first();
  const otherPresence = await env.DB.prepare(
    "SELECT display_name, name, avatar_file_id, photo_url FROM user_presence WHERE user_id = ?"
  ).bind(otherId).first();

  const other = {
    user_id: otherId,
    name: (otherPresence && (otherPresence.display_name || otherPresence.name)) || ("Пользователь " + otherId),
    avatar_url: otherPresence && otherPresence.avatar_file_id
      ? "/api/tg-photo?file_id=" + encodeURIComponent(otherPresence.avatar_file_id)
      : (otherPresence && otherPresence.photo_url) || null,
  };

  return json({ thread_id: thread.id, other: other });
}
