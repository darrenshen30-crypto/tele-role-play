// functions/api/story-like.js — поставить/убрать лайк на историю (тумблер).
// Свою историю лайкнуть нельзя. Лайк ставится от лица персонажа лайкнувшего,
// не аккаунта, поэтому запрос на постановку лайка (не на снятие) обязан
// прислать character_id - имя/аватар персонажа снимаются на момент лайка
// (тот же снапшот-паттерн, что у stories.character_name). Кто именно лайкнул,
// видно только автору истории (отдаётся вместе с /api/stories как likers) -
// остальным виден только тот факт, что лайк у них самих стоит (liked_by_me).

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status: status, headers: { "Content-Type": "application/json" } });
}

function isOwner(env, id) {
  if (!env.OWNER_ID || !id) return false;
  const ids = String(env.OWNER_ID).split(",").map(function (s) { return s.trim(); }).filter(Boolean);
  return ids.indexOf(String(id)) !== -1;
}

export async function onRequestPost(context) {
  const env = context.env;
  const userId = context.data && context.data.tgUserId;
  if (!isOwner(env, userId)) return json({ error: "Нет доступа." }, 403);

  const id = new URL(context.request.url).searchParams.get("id");
  if (!id) return json({ error: "Не указана история." }, 400);

  const story = await env.DB.prepare("SELECT id, owner_id FROM stories WHERE id = ?").bind(id).first();
  if (!story) return json({ error: "История не найдена." }, 404);
  if (String(story.owner_id) === String(userId)) return json({ error: "Нельзя лайкнуть свою историю." }, 403);

  const existing = await env.DB.prepare("SELECT 1 FROM story_likes WHERE story_id = ? AND user_id = ?")
    .bind(id, String(userId)).first();

  try {
    if (existing) {
      await env.DB.prepare("DELETE FROM story_likes WHERE story_id = ? AND user_id = ?").bind(id, String(userId)).run();
      return json({ liked: false });
    }

    let body = {};
    try { body = await context.request.json(); } catch (e) { body = {}; }
    const characterId = body.character_id;
    if (!characterId) return json({ error: "Выберите своего персонажа для лайка." }, 400);

    const character = await env.DB.prepare("SELECT id, name, avatar_file_id FROM characters WHERE id = ? AND owner_id = ?")
      .bind(characterId, String(userId)).first();
    if (!character) return json({ error: "Это не ваш персонаж." }, 403);

    await env.DB.prepare(
      "INSERT INTO story_likes (story_id, user_id, character_id, character_name, character_avatar_file_id) VALUES (?, ?, ?, ?, ?)"
    ).bind(id, String(userId), character.id, character.name, character.avatar_file_id).run();
    return json({ liked: true });
  } catch (e) {
    console.log("Ошибка лайка истории:", e.message);
    return json({ error: "Не удалось поставить лайк." }, 500);
  }
}
