// functions/api/message-reveal.js — отметить, что человек нажал на заблюренное
// фото в сообщении и посмотрел его. Открытие запоминается навсегда для этого
// человека (не заново при каждом заходе в комнату).

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

  const body = await context.request.json();
  const messageId = body.message_id;
  if (!messageId) return json({ error: "Не указано сообщение." }, 400);

  try {
    await env.DB.prepare(
      "INSERT OR IGNORE INTO club_photo_reveals (message_id, user_id) VALUES (?, ?)"
    ).bind(messageId, String(userId)).run();
  } catch (e) {
    console.log("Ошибка сохранения открытия фото:", e.message);
    return json({ error: "Не удалось открыть фото." }, 500);
  }

  return json({ ok: true });
}
