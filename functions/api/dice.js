// functions/api/dice.js — бросок шестигранного кубика в чате локации.
// Результат генерируется на сервере (не клиентом) и пишется в club_messages
// как обычное сообщение с заполненным dice_value - остальные участники видят
// его через тот же опрос /api/messages, что и текст/фото, анимацию проигрывает
// уже фронтенд при получении сообщения.

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status: status, headers: { "Content-Type": "application/json" } });
}

function isOwner(env, id) {
  if (!env.OWNER_ID || !id) return false;
  const ids = String(env.OWNER_ID).split(",").map(function (s) { return s.trim(); }).filter(Boolean);
  return ids.indexOf(String(id)) !== -1;
}

function ownerIdList(env) {
  return env.OWNER_ID ? String(env.OWNER_ID).split(",").map(function (s) { return s.trim(); }).filter(Boolean) : [];
}

const ONLINE_WINDOW_MS = 60000;

async function notifyRecipients(env, clubId, senderId, messageId) {
  const { results } = await env.DB.prepare(
    "SELECT DISTINCT owner_id FROM characters WHERE owner_id != ?"
  ).bind(String(senderId)).all();

  for (const row of results || []) {
    const recipientId = row.owner_id;
    if (!isOwner(env, recipientId)) continue;
    try {
      const readRow = await env.DB.prepare(
        "SELECT last_read_message_id, last_notified_message_id FROM club_reads WHERE club_id = ? AND user_id = ?"
      ).bind(clubId, String(recipientId)).first();
      const lastRead = readRow ? readRow.last_read_message_id : 0;
      const lastNotified = readRow ? readRow.last_notified_message_id : 0;
      if (messageId <= lastRead || messageId <= lastNotified) continue;

      const presence = await env.DB.prepare("SELECT last_seen FROM user_presence WHERE user_id = ?").bind(String(recipientId)).first();
      const lastSeenMs = presence && presence.last_seen ? new Date(presence.last_seen).getTime() : 0;
      if (Date.now() - lastSeenMs < ONLINE_WINDOW_MS) continue;

      await fetch("https://api.telegram.org/bot" + env.BOT_TOKEN + "/sendMessage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: recipientId, text: "У вас новое непрочитанное сообщение." }),
      });

      await env.DB.prepare(
        "INSERT INTO club_reads (club_id, user_id, last_read_message_id, last_notified_message_id) VALUES (?, ?, 0, ?) " +
          "ON CONFLICT(club_id, user_id) DO UPDATE SET last_notified_message_id = excluded.last_notified_message_id"
      ).bind(clubId, String(recipientId), messageId).run();
    } catch (e) {
      console.log("Ошибка уведомления получателя " + recipientId + ":", e.message);
    }
  }
}

export async function onRequestPost(context) {
  const env = context.env;
  const userId = context.data && context.data.tgUserId;
  const userName = context.data && context.data.tgUserName;
  if (!isOwner(env, userId)) return json({ error: "Нет доступа." }, 403);

  const clubId = new URL(context.request.url).searchParams.get("club_id");
  if (!clubId) return json({ error: "Не указана локация." }, 400);

  const body = await context.request.json();
  const characterId = body.character_id;
  if (!characterId) return json({ error: "Сначала выберите персонажа." }, 400);

  const character = await env.DB.prepare("SELECT id, owner_id, name, avatar_file_id, gender FROM characters WHERE id = ?")
    .bind(characterId).first();
  if (!character || String(character.owner_id) !== String(userId)) {
    return json({ error: "Это не ваш персонаж." }, 403);
  }

  const diceValue = 1 + Math.floor(Math.random() * 6);

  let message = null;
  try {
    message = await env.DB.prepare(
      "INSERT INTO club_messages (club_id, user_id, user_name, text, character_id, character_name, character_avatar_file_id, dice_value) " +
        "VALUES (?, ?, ?, '', ?, ?, ?, ?) " +
        "RETURNING id, user_id, user_name, text, created_at, edited_at, character_id, character_name, character_avatar_file_id, is_attention, photo_file_id, photo_blurred, dice_value"
    ).bind(clubId, String(userId), userName || null, character.id, character.name, character.avatar_file_id, diceValue).first();
  } catch (e) {
    console.log("Ошибка броска кубика:", e.message);
    return json({ error: "Не удалось бросить кубик." }, 500);
  }
  message.character_gender = character.gender;
  message.photo_revealed = 1;

  context.waitUntil(notifyRecipients(env, clubId, userId, message.id));
  // Кэш "последнего сообщения" на clubs (см. clubs.js) - без этого список
  // локаций не заметил бы, что тут только что бросили кубик.
  context.waitUntil(env.DB.prepare(
    "UPDATE clubs SET last_message_id = ?, last_message_user_id = ?, last_message_text = '', last_message_character = ? WHERE id = ?"
  ).bind(message.id, String(userId), character.name, clubId).run());

  return json({ message: message });
}
