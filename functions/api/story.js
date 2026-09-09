// functions/api/story.js — досрочное удаление своей истории (до истечения 24
// часов). Только автор (owner_id) может удалить, как и с персонажами.

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
  if (!id) return json({ error: "Не указана история." }, 400);

  const existing = await env.DB.prepare("SELECT id, owner_id FROM stories WHERE id = ?").bind(id).first();
  if (!existing) return json({ error: "История не найдена." }, 404);
  if (String(existing.owner_id) !== String(userId)) return json({ error: "Это не ваша история." }, 403);

  try {
    await env.DB.prepare("DELETE FROM stories WHERE id = ?").bind(id).run();
  } catch (e) {
    console.log("Ошибка удаления истории:", e.message);
    return json({ error: "Не удалось удалить историю." }, 500);
  }

  return json({ ok: true });
}
