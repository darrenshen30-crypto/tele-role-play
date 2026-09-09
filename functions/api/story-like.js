// functions/api/story-like.js — поставить/убрать лайк на историю (тумблер).
// Свою историю лайкнуть нельзя. Кто именно лайкнул, видно только автору
// истории (отдаётся вместе с /api/stories как likers) - остальным виден
// только тот факт, что лайк у них самих стоит (liked_by_me).

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
    await env.DB.prepare("INSERT INTO story_likes (story_id, user_id) VALUES (?, ?)").bind(id, String(userId)).run();
    return json({ liked: true });
  } catch (e) {
    console.log("Ошибка лайка истории:", e.message);
    return json({ error: "Не удалось поставить лайк." }, 500);
  }
}
