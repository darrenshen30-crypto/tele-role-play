// functions/api/messages.js — история сообщений локации и отправка новых.
// Живой эффект чата даёт короткий опрос (poll) с фронтенда каждые пару секунд -
// без вебсокетов, чтобы не заводить отдельное realtime-соединение. Опрос ловит
// не только новые сообщения (id больше after_id), но и отредактированные
// старые (edited_at больше after_edit) - иначе собеседник не увидит правку.

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status: status, headers: { "Content-Type": "application/json" } });
}

function isOwner(env, id) {
  if (!env.OWNER_ID || !id) return false;
  const ids = String(env.OWNER_ID).split(",").map(function (s) { return s.trim(); }).filter(Boolean);
  return ids.indexOf(String(id)) !== -1;
}

export async function onRequestGet(context) {
  const env = context.env;
  const userId = context.data && context.data.tgUserId;
  if (!isOwner(env, userId)) return json({ error: "Нет доступа." }, 403);

  const params = new URL(context.request.url).searchParams;
  const clubId = params.get("club_id");
  const afterId = params.get("after_id") || "0";
  const afterEdit = params.get("after_edit") || "";
  if (!clubId) return json({ error: "Не указана локация." }, 400);

  const { results } = await env.DB.prepare(
    "SELECT id, user_id, user_name, text, created_at, edited_at, character_name, character_avatar_file_id " +
      "FROM club_messages WHERE club_id = ? AND (id > ? OR (edited_at IS NOT NULL AND edited_at > ?)) ORDER BY id ASC LIMIT 200"
  ).bind(clubId, afterId, afterEdit).all();

  const otherRead = await env.DB.prepare(
    "SELECT MIN(last_read_message_id) AS v FROM club_reads WHERE club_id = ? AND user_id != ?"
  ).bind(clubId, String(userId)).first();

  return json({ messages: results || [], other_read_id: (otherRead && otherRead.v != null) ? otherRead.v : 0 });
}

export async function onRequestPost(context) {
  const env = context.env;
  const userId = context.data && context.data.tgUserId;
  const userName = context.data && context.data.tgUserName;
  if (!isOwner(env, userId)) return json({ error: "Нет доступа." }, 403);

  const clubId = new URL(context.request.url).searchParams.get("club_id");
  if (!clubId) return json({ error: "Не указана локация." }, 400);

  const body = await context.request.json();
  const text = (body.text || "").trim();
  const characterId = body.character_id;
  if (!text) return json({ error: "Пустое сообщение." }, 400);
  if (text.length > 4000) return json({ error: "Слишком длинное сообщение." }, 400);
  if (!characterId) return json({ error: "Сначала выберите персонажа." }, 400);

  const character = await env.DB.prepare("SELECT id, owner_id, name, avatar_file_id FROM characters WHERE id = ?")
    .bind(characterId).first();
  if (!character || String(character.owner_id) !== String(userId)) {
    return json({ error: "Это не ваш персонаж." }, 403);
  }

  let message = null;
  try {
    message = await env.DB.prepare(
      "INSERT INTO club_messages (club_id, user_id, user_name, text, character_id, character_name, character_avatar_file_id) " +
        "VALUES (?, ?, ?, ?, ?, ?, ?) " +
        "RETURNING id, user_id, user_name, text, created_at, edited_at, character_name, character_avatar_file_id"
    ).bind(clubId, String(userId), userName || null, text, character.id, character.name, character.avatar_file_id).first();
  } catch (e) {
    console.log("Ошибка отправки сообщения:", e.message);
    return json({ error: "Не удалось отправить сообщение." }, 500);
  }
  return json({ message: message });
}
