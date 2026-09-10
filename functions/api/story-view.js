// functions/api/story-view.js — отметить историю просмотренной текущим
// пользователем. Идемпотентно (INSERT OR IGNORE) - открыть историю повторно
// не создаёт новых записей и не считается ошибкой. Свою историю отдельно
// отмечать не нужно - stories.js сам считает viewed_by_me истинным для
// автора без записи в этой таблице.

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

  try {
    await env.DB.prepare(
      "INSERT OR IGNORE INTO story_views (story_id, user_id) VALUES (?, ?)"
    ).bind(id, String(userId)).run();
  } catch (e) {
    console.log("Ошибка отметки просмотра истории:", e.message);
    return json({ error: "Не удалось отметить просмотр." }, 500);
  }

  return json({ ok: true });
}
