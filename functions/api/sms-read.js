// functions/api/sms-read.js — отметить SMS-переписку прочитанной до
// указанного id (для значка "непрочитано" в списке переписок).

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
  const threadId = body.thread_id;
  const messageId = Number(body.message_id) || 0;
  if (!threadId) return json({ error: "Не указана переписка." }, 400);

  try {
    await env.DB.prepare(
      "INSERT INTO sms_reads (thread_id, user_id, last_read_message_id) VALUES (?, ?, ?) " +
        "ON CONFLICT(thread_id, user_id) DO UPDATE SET last_read_message_id = MAX(last_read_message_id, excluded.last_read_message_id)"
    ).bind(threadId, String(userId), messageId).run();
  } catch (e) {
    console.log("Ошибка отметки прочтения SMS:", e.message);
    return json({ error: "Не удалось отметить прочитанным." }, 500);
  }
  return json({ ok: true });
}
