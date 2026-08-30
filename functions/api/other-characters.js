// functions/api/other-characters.js — список персонажей ВТОРОГО человека, для
// адресной книги SMS (обычно персонажи полностью личные - здесь единственное
// намеренное исключение, чтобы было кому писать).

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
    "SELECT id, name, birthdate, avatar_file_id FROM characters WHERE owner_id != ? ORDER BY created_at"
  ).bind(String(userId)).all();

  return json({ characters: results || [] });
}
