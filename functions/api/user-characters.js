// functions/api/user-characters.js — персонажи конкретного человека (по его
// Telegram id), для просмотра из списка пользователей на стартовом экране.
// Как и в other-characters.js, это намеренное исключение из "персонажи личные" -
// в этом мини-аппе всего два-три человека и все видят, кто чем играет.

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

  const targetId = new URL(context.request.url).searchParams.get("user_id");
  if (!targetId) return json({ error: "Не указан пользователь." }, 400);

  const { results } = await env.DB.prepare(
    "SELECT id, name, birthdate, avatar_file_id, gender FROM characters WHERE owner_id = ? ORDER BY created_at"
  ).bind(String(targetId)).all();

  return json({ characters: results || [] });
}
