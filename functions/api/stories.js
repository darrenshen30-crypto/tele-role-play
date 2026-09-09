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
    "SELECT s.id, s.owner_id, s.character_id, s.character_name, s.character_avatar_file_id, s.photo_file_id, s.created_at, " +
      "(SELECT COUNT(*) FROM story_likes sl WHERE sl.story_id = s.id) AS like_count, " +
      "EXISTS(SELECT 1 FROM story_likes sl2 WHERE sl2.story_id = s.id AND sl2.user_id = ?) AS liked_by_me " +
      "FROM stories s WHERE s.created_at > datetime('now', '-1 day') ORDER BY s.id ASC"
  ).bind(String(userId)).all();

  const stories = (results || []).map(function (row) {
    return {
      id: row.id, owner_id: row.owner_id, character_id: row.character_id, character_name: row.character_name,
      character_avatar_file_id: row.character_avatar_file_id, photo_file_id: row.photo_file_id, created_at: row.created_at,
      like_count: row.like_count || 0, liked_by_me: !!row.liked_by_me,
    };
  });

  // Кто именно лайкнул - видно только автору истории, остальным только факт
  // своего лайка (liked_by_me выше). Отдельный запрос, чтобы не тянуть имена
  // лайкнувших чужие истории.
  const { results: likerRows } = await env.DB.prepare(
    "SELECT sl.story_id, COALESCE(up.display_name, up.name, 'Кто-то') AS name " +
      "FROM story_likes sl JOIN stories s ON s.id = sl.story_id LEFT JOIN user_presence up ON up.user_id = sl.user_id " +
      "WHERE s.owner_id = ? AND s.created_at > datetime('now', '-1 day')"
  ).bind(String(userId)).all();
  const likersByStory = {};
  (likerRows || []).forEach(function (row) {
    (likersByStory[row.story_id] = likersByStory[row.story_id] || []).push(row.name);
  });
  stories.forEach(function (s) {
    if (String(s.owner_id) === String(userId)) s.likers = likersByStory[s.id] || [];
  });

  return json({ stories: stories });
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
