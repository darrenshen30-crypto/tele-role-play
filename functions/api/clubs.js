// functions/api/clubs.js — список локаций и создание новой.
// Доступ только тем Telegram id, что перечислены в OWNER_ID (через запятую) -
// приглашений нет, оба человека сразу видят все локации.

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
    "SELECT c.id, c.name, c.category, c.background_file_id, c.background_updated_at, c.music_url, c.owner_id, " +
      "lm.id AS last_message_id, lm.user_id AS last_message_user_id, " +
      "COALESCE(r.last_read_message_id, 0) AS last_read_message_id " +
      "FROM clubs c " +
      "LEFT JOIN (SELECT club_id, MAX(id) AS id FROM club_messages GROUP BY club_id) lmid ON lmid.club_id = c.id " +
      "LEFT JOIN club_messages lm ON lm.id = lmid.id " +
      "LEFT JOIN club_reads r ON r.club_id = c.id AND r.user_id = ? " +
      "ORDER BY c.category, c.name"
  ).bind(String(userId)).all();

  const clubs = (results || []).map(function (row) {
    const unread = !!row.last_message_id &&
      String(row.last_message_user_id) !== String(userId) &&
      row.last_message_id > row.last_read_message_id;
    return {
      id: row.id, name: row.name, category: row.category,
      background_file_id: row.background_file_id, background_updated_at: row.background_updated_at,
      music_url: row.music_url, owner_id: row.owner_id, unread: unread,
    };
  });

  return json({ clubs: clubs });
}

export async function onRequestPost(context) {
  const env = context.env;
  const userId = context.data && context.data.tgUserId;
  if (!isOwner(env, userId)) return json({ error: "Нет доступа." }, 403);

  const body = await context.request.json();
  const category = (body.category || "").trim();
  const name = (body.name || "").trim();
  if (!category) return json({ error: "Введите категорию." }, 400);
  if (!name) return json({ error: "Введите название." }, 400);

  let club = null;
  try {
    club = await env.DB.prepare(
      "INSERT INTO clubs (name, category, owner_id) VALUES (?, ?, ?) " +
        "RETURNING id, name, category, background_file_id, background_updated_at, music_url, owner_id"
    ).bind(name, category, String(userId)).first();
  } catch (e) {
    console.log("Ошибка создания локации:", e.message);
    return json({ error: "Не удалось создать локацию." }, 500);
  }

  return json({ club: Object.assign({ unread: false }, club) });
}
