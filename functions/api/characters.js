// functions/api/characters.js — список своих персонажей и создание нового.
// Персонажи личные: каждый видит и редактирует только созданных им самим
// (owner_id = свой Telegram id), даже при общем доступе к локациям.

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
    "SELECT id, name, birthdate, description, avatar_file_id FROM characters WHERE owner_id = ? ORDER BY created_at"
  ).bind(String(userId)).all();

  return json({ characters: results || [] });
}

export async function onRequestPost(context) {
  const env = context.env;
  const userId = context.data && context.data.tgUserId;
  if (!isOwner(env, userId)) return json({ error: "Нет доступа." }, 403);

  const body = await context.request.json();
  const name = (body.name || "").trim();
  const birthdate = (body.birthdate || "").trim();
  const description = (body.description || "").trim();
  const avatarFileId = (body.avatar_file_id || "").trim();
  if (!name) return json({ error: "Введите имя персонажа." }, 400);
  if (!avatarFileId) return json({ error: "Загрузите аватар." }, 400);

  let character = null;
  try {
    character = await env.DB.prepare(
      "INSERT INTO characters (owner_id, name, birthdate, description, avatar_file_id) VALUES (?, ?, ?, ?, ?) " +
        "RETURNING id, name, birthdate, description, avatar_file_id"
    ).bind(String(userId), name, birthdate || null, description || null, avatarFileId).first();
  } catch (e) {
    console.log("Ошибка создания персонажа:", e.message);
    return json({ error: "Не удалось создать персонажа." }, 500);
  }

  return json({ character: character });
}
