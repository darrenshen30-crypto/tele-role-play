// functions/api/club-attention-dismiss.js — закрыть плашку "Внимание!" до
// указанного сообщения (запоминается, чтобы не всплывала повторно при
// следующем открытии комнаты).

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
  const clubId = body.club_id;
  const messageId = Number(body.message_id) || 0;
  if (!clubId) return json({ error: "Не указана локация." }, 400);

  try {
    await env.DB.prepare(
      "INSERT INTO club_attention_dismissed (club_id, user_id, last_dismissed_id) VALUES (?, ?, ?) " +
        "ON CONFLICT(club_id, user_id) DO UPDATE SET last_dismissed_id = MAX(last_dismissed_id, excluded.last_dismissed_id)"
    ).bind(clubId, String(userId), messageId).run();
  } catch (e) {
    console.log("Ошибка закрытия предупреждения:", e.message);
    return json({ error: "Не удалось закрыть предупреждение." }, 500);
  }
  return json({ ok: true });
}
