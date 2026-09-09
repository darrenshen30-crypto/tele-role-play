// functions/api/stories.js — активные истории (список + публикация).
// Как и club_messages, снимок character_name/character_avatar_file_id
// делается в момент публикации - история не меняется задним числом, если
// персонажа потом отредактируют. "Активна" = опубликована не позже 24 часов
// назад; строки старше суток чистятся тут же по ходу GET, отдельного cron нет.

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

  context.waitUntil(
    env.DB.prepare("DELETE FROM stories WHERE created_at <= datetime('now', '-1 day')").run()
      .catch(function (e) { console.log("Ошибка очистки старых историй:", e.message); })
  );

  const { results } = await env.DB.prepare(
    "SELECT id, owner_id, character_id, character_name, character_avatar_file_id, photo_file_id, created_at " +
      "FROM stories WHERE created_at > datetime('now', '-1 day') ORDER BY id ASC"
  ).all();

  return json({ stories: results || [] });
}

export async function onRequestPost(context) {
  const env = context.env;
  const userId = context.data && context.data.tgUserId;
  if (!isOwner(env, userId)) return json({ error: "Нет доступа." }, 403);

  const body = await context.request.json();
  const characterId = body.character_id;
  const photoFileId = (body.photo_file_id || "").trim();
  if (!characterId) return json({ error: "Сначала выберите персонажа." }, 400);
  if (!photoFileId) return json({ error: "Загрузите фото." }, 400);

  const character = await env.DB.prepare("SELECT id, owner_id, name, avatar_file_id FROM characters WHERE id = ?")
    .bind(characterId).first();
  if (!character || String(character.owner_id) !== String(userId)) {
    return json({ error: "Это не ваш персонаж." }, 403);
  }

  let story = null;
  try {
    story = await env.DB.prepare(
      "INSERT INTO stories (owner_id, character_id, character_name, character_avatar_file_id, photo_file_id) " +
        "VALUES (?, ?, ?, ?, ?) " +
        "RETURNING id, owner_id, character_id, character_name, character_avatar_file_id, photo_file_id, created_at"
    ).bind(String(userId), character.id, character.name, character.avatar_file_id, photoFileId).first();
  } catch (e) {
    console.log("Ошибка публикации истории:", e.message);
    return json({ error: "Не удалось опубликовать историю." }, 500);
  }

  return json({ story: story });
}
