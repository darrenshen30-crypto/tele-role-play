// functions/api/call-respond.js — отметить входящий звонок как принятый или
// отклонённый. Обновляет ТУ ЖЕ строку club_messages (call_response), а не
// создаёт новое сообщение - поэтому и звонящий, и тот, кому звонили, видят
// исход прямо на исходной записи о звонке (через обычный опрос по edited_at,
// см. messages.js), а не отдельной, ничем не связанной репликой в ленте.

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

  const clubId = new URL(context.request.url).searchParams.get("club_id");
  if (!clubId) return json({ error: "Не указана локация." }, 400);

  const body = await context.request.json();
  const messageId = body.message_id;
  const accepted = !!body.accepted;
  if (!messageId) return json({ error: "Не указан звонок." }, 400);

  const row = await env.DB.prepare(
    "SELECT cm.id, cm.call_to_character_id, callee.owner_id AS callee_owner " +
      "FROM club_messages cm LEFT JOIN characters callee ON callee.id = cm.call_to_character_id " +
      "WHERE cm.id = ? AND cm.club_id = ?"
  ).bind(messageId, clubId).first();
  if (!row || !row.call_to_character_id) return json({ error: "Звонок не найден." }, 404);
  if (String(row.callee_owner) !== String(userId)) return json({ error: "Это не ваш звонок." }, 403);

  let message = null;
  try {
    message = await env.DB.prepare(
      "UPDATE club_messages SET call_response = ?, edited_at = CURRENT_TIMESTAMP WHERE id = ? " +
        "RETURNING id, call_response, edited_at"
    ).bind(accepted ? "accepted" : "declined", messageId).first();
  } catch (e) {
    console.log("Ошибка ответа на звонок:", e.message);
    return json({ error: "Не удалось сохранить ответ." }, 500);
  }

  return json({ message: message });
}
