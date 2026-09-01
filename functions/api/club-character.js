// functions/api/club-character.js — какой персонаж выбран для конкретной
// локации у текущего пользователя (запоминается между заходами).

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

  const clubId = new URL(context.request.url).searchParams.get("club_id");
  if (!clubId) return json({ error: "Не указана локация." }, 400);

  const row = await env.DB.prepare(
    "SELECT ch.id, ch.name, ch.birthdate, ch.description, ch.avatar_file_id, ch.gender " +
      "FROM club_character_choice cc JOIN characters ch ON ch.id = cc.character_id " +
      "WHERE cc.club_id = ? AND cc.user_id = ? AND ch.owner_id = ?"
  ).bind(clubId, String(userId), String(userId)).first();

  return json({ character: row || null });
}

export async function onRequestPost(context) {
  const env = context.env;
  const userId = context.data && context.data.tgUserId;
  if (!isOwner(env, userId)) return json({ error: "Нет доступа." }, 403);

  const body = await context.request.json();
  const clubId = body.club_id;
  const characterId = body.character_id;
  if (!clubId) return json({ error: "Не указана локация." }, 400);
  if (!characterId) return json({ error: "Не указан персонаж." }, 400);

  const character = await env.DB.prepare("SELECT id, owner_id FROM characters WHERE id = ?").bind(characterId).first();
  if (!character || String(character.owner_id) !== String(userId)) {
    return json({ error: "Это не ваш персонаж." }, 403);
  }

  try {
    await env.DB.prepare(
      "INSERT INTO club_character_choice (club_id, user_id, character_id) VALUES (?, ?, ?) " +
        "ON CONFLICT(club_id, user_id) DO UPDATE SET character_id = excluded.character_id"
    ).bind(clubId, String(userId), characterId).run();
  } catch (e) {
    console.log("Ошибка сохранения выбора персонажа:", e.message);
    return json({ error: "Не удалось сохранить выбор." }, 500);
  }

  return json({ ok: true });
}
