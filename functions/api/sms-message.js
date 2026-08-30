// functions/api/sms-message.js — редактирование одного SMS-сообщения.
// Разрешено только автору.

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status: status, headers: { "Content-Type": "application/json" } });
}

function isOwner(env, id) {
  if (!env.OWNER_ID || !id) return false;
  const ids = String(env.OWNER_ID).split(",").map(function (s) { return s.trim(); }).filter(Boolean);
  return ids.indexOf(String(id)) !== -1;
}

export async function onRequestPatch(context) {
  const env = context.env;
  const userId = context.data && context.data.tgUserId;
  if (!isOwner(env, userId)) return json({ error: "Нет доступа." }, 403);

  const id = new URL(context.request.url).searchParams.get("id");
  if (!id) return json({ error: "Не указано сообщение." }, 400);

  const body = await context.request.json();
  const text = (body.text || "").trim();
  if (!text) return json({ error: "Пустое сообщение." }, 400);
  if (text.length > 4000) return json({ error: "Слишком длинное сообщение." }, 400);

  const existing = await env.DB.prepare("SELECT id, sender_user_id FROM sms_messages WHERE id = ?").bind(id).first();
  if (!existing) return json({ error: "Сообщение не найдено." }, 404);
  if (String(existing.sender_user_id) !== String(userId)) {
    return json({ error: "Можно редактировать только свои сообщения." }, 403);
  }

  const editedAt = new Date().toISOString();
  let updated = null;
  try {
    updated = await env.DB.prepare(
      "UPDATE sms_messages SET text = ?, edited_at = ? WHERE id = ? " +
        "RETURNING id, sender_user_id, character_name, character_avatar_file_id, text, created_at, edited_at"
    ).bind(text, editedAt, id).first();
  } catch (e) {
    console.log("Ошибка редактирования SMS:", e.message);
    return json({ error: "Не удалось отредактировать сообщение." }, 500);
  }
  return json({ message: updated });
}
