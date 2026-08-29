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
    "SELECT id, name, category, background_file_id, background_updated_at, music_url, owner_id " +
      "FROM clubs ORDER BY category, name"
  ).all();

  return json({ clubs: results || [] });
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

  return json({ club: club });
}
