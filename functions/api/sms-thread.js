// functions/api/sms-thread.js — удаление одной SMS-переписки целиком.
// Переписка всегда между персонажами двух РАЗНЫХ владельцев (проверяется при
// создании в sms-threads.js), поэтому любой из двух разрешённых пользователей
// уже по построению - участник любой существующей переписки: отдельная
// проверка "это точно ваша переписка" не нужна, как и для локаций (club.js).
// Удаление безвозвратное и общее для обоих - не "скрыть у себя".

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status: status, headers: { "Content-Type": "application/json" } });
}

function isOwner(env, id) {
  if (!env.OWNER_ID || !id) return false;
  const ids = String(env.OWNER_ID).split(",").map(function (s) { return s.trim(); }).filter(Boolean);
  return ids.indexOf(String(id)) !== -1;
}

export async function onRequestDelete(context) {
  const env = context.env;
  const userId = context.data && context.data.tgUserId;
  if (!isOwner(env, userId)) return json({ error: "Нет доступа." }, 403);

  const id = new URL(context.request.url).searchParams.get("id");
  if (!id) return json({ error: "Не указана переписка." }, 400);

  const thread = await env.DB.prepare("SELECT id FROM sms_threads WHERE id = ?").bind(id).first();
  if (!thread) return json({ error: "Переписка не найдена." }, 404);

  try {
    await env.DB.batch([
      env.DB.prepare("DELETE FROM sms_reads WHERE thread_id = ?").bind(id),
      env.DB.prepare("DELETE FROM sms_messages WHERE thread_id = ?").bind(id),
      env.DB.prepare("DELETE FROM sms_threads WHERE id = ?").bind(id),
    ]);
  } catch (e) {
    console.log("Ошибка удаления переписки:", e.message);
    return json({ error: "Не удалось удалить переписку." }, 500);
  }

  return json({ ok: true });
}
