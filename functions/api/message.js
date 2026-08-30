// functions/api/message.js — редактирование уже отправленного сообщения.
// Разрешено только автору редактировать своё же сообщение.

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

  const existing = await env.DB.prepare("SELECT id, user_id FROM club_messages WHERE id = ?").bind(id).first();
  if (!existing) return json({ error: "Сообщение не найдено." }, 404);
  if (String(existing.user_id) !== String(userId)) {
    return json({ error: "Можно редактировать только свои сообщения." }, 403);
  }

  const editedAt = new Date().toISOString();
  let updated = null;
  try {
    updated = await env.DB.prepare(
      "UPDATE club_messages SET text = ?, edited_at = ? WHERE id = ? " +
        "RETURNING id, user_id, user_name, text, created_at, edited_at"
    ).bind(text, editedAt, id).first();
  } catch (e) {
    console.log("Ошибка редактирования сообщения:", e.message);
    return json({ error: "Не удалось отредактировать сообщение." }, 500);
  }
  return json({ message: updated });
}
