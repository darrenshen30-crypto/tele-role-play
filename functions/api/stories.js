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
  // своего лайка (liked_by_me выше). Показываем персонажа лайкнувшего (снятый
  // на момент лайка снапшот в story_likes), а не реальный аккаунт - лайк
  // ставится от лица персонажа. Отдельный запрос, чтобы не тянуть имена
  // лайкнувших чужие истории.
  const { results: likerRows } = await env.DB.prepare(
    "SELECT sl.story_id, sl.character_name AS name, sl.character_avatar_file_id AS avatar_file_id " +
      "FROM story_likes sl JOIN stories s ON s.id = sl.story_id " +
      "WHERE s.owner_id = ? AND s.created_at > datetime('now', '-1 day')"
  ).bind(String(userId)).all();
  const likersByStory = {};
  (likerRows || []).forEach(function (row) {
    (likersByStory[row.story_id] = likersByStory[row.story_id] || []).push({ name: row.name, avatar_file_id: row.avatar_file_id });
  });
  stories.forEach(function (s) {
    if (String(s.owner_id) === String(userId)) s.likers = likersByStory[s.id] || [];
  });

  // Отметки персонажей - видны всем (как подпись "с ..." в Instagram), не
  // приватная информация в отличие от лайков. Снапшот в story_tags, тот же
  // паттерн, что и у самой истории/лайков - можно отметить и своего, и
  // персонажа второго человека.
  const { results: tagRows } = await env.DB.prepare(
    "SELECT story_id, character_id, character_name, character_avatar_file_id " +
      "FROM story_tags WHERE story_id IN (SELECT id FROM stories WHERE created_at > datetime('now', '-1 day'))"
  ).all();
  const tagsByStory = {};
  (tagRows || []).forEach(function (row) {
    (tagsByStory[row.story_id] = tagsByStory[row.story_id] || []).push({
      character_id: row.character_id, name: row.character_name, avatar_file_id: row.character_avatar_file_id,
    });
  });
  stories.forEach(function (s) { s.tags = tagsByStory[s.id] || []; });

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

  // Отметить можно любого персонажа, включая персонажа второго человека -
  // это открытая функция вроде тегов в Instagram, а не приватная (как SMS,
  // где адресную книгу нарочно ограничили).
  const rawTagIds = Array.isArray(body.tagged_character_ids) ? body.tagged_character_ids : [];
  const tagIds = Array.from(new Set(rawTagIds.map(Number).filter(function (n) { return n && n !== character.id; })));
  let taggedCharacters = [];
  if (tagIds.length) {
    const placeholders = tagIds.map(function () { return "?"; }).join(",");
    const { results } = await env.DB.prepare(
      "SELECT id, name, avatar_file_id FROM characters WHERE id IN (" + placeholders + ")"
    ).bind(...tagIds).all();
    taggedCharacters = results || [];
  }

  let story = null;
  try {
    story = await env.DB.prepare(
      "INSERT INTO stories (owner_id, character_id, character_name, character_avatar_file_id, photo_file_id) " +
        "VALUES (?, ?, ?, ?, ?) " +
        "RETURNING id, owner_id, character_id, character_name, character_avatar_file_id, photo_file_id, created_at"
    ).bind(String(userId), character.id, character.name, character.avatar_file_id, photoFileId).first();

    for (const tagged of taggedCharacters) {
      await env.DB.prepare(
        "INSERT INTO story_tags (story_id, character_id, character_name, character_avatar_file_id) VALUES (?, ?, ?, ?)"
      ).bind(story.id, tagged.id, tagged.name, tagged.avatar_file_id).run();
    }
  } catch (e) {
    console.log("Ошибка публикации истории:", e.message);
    return json({ error: "Не удалось опубликовать историю." }, 500);
  }

  story.tags = taggedCharacters.map(function (c) { return { character_id: c.id, name: c.name, avatar_file_id: c.avatar_file_id }; });
  return json({ story: story });
}
