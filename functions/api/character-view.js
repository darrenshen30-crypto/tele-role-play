// functions/api/character-view.js — просмотр анкеты персонажа по клику на
// автора сообщения в комнате. Персонажи обычно личные, но здесь, как и в
// other-characters.js, намеренное исключение: в этом мини-аппе всего два
// пользователя и все комнаты общие, так что просмотр чужого персонажа,
// уже написавшего сообщение в общей комнате, не раскрывает ничего нового.

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

  const id = new URL(context.request.url).searchParams.get("id");
  if (!id) return json({ error: "Не указан персонаж." }, 400);

  const character = await env.DB.prepare(
    "SELECT id, name, birthdate, description, avatar_file_id, gender FROM characters WHERE id = ?"
  ).bind(id).first();

  return json({ character: character || null });
}
