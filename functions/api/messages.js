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

// Сообщение целиком в # ... # - пометка "это может повлиять на реакцию персонажа".
function isAttentionText(text) {
  return text.length >= 3 && text[0] === "#" && text[text.length - 1] === "#";
}

// Считаем "в сети" по свежему присутствию (см. _middleware.js) - если человек
// сейчас активен в приложении, не шлём ему уведомление о том же сообщении,
// которое он и так вот-вот увидит.
const ONLINE_WINDOW_MS = 60000;

async function notifyRecipients(env, clubId, senderId, messageId) {
  const { results } = await env.DB.prepare(
    "SELECT DISTINCT owner_id FROM characters WHERE owner_id != ?"
  ).bind(String(senderId)).all();

  for (const row of results || []) {
    const recipientId = row.owner_id;
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

      const resp = await fetch("https://api.telegram.org/bot" + env.BOT_TOKEN + "/sendMessage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: recipientId, text: "У вас новое непрочитанное сообщение." }),
      });
      if (!resp.ok) {
        console.log("Telegram sendMessage отказал (" + resp.status + ") для " + recipientId + ":", await resp.text());
      }

      await env.DB.prepare(
        "INSERT INTO club_reads (club_id, user_id, last_read_message_id, last_notified_message_id) VALUES (?, ?, 0, ?) " +
          "ON CONFLICT(club_id, user_id) DO UPDATE SET last_notified_message_id = excluded.last_notified_message_id"
      ).bind(clubId, String(recipientId), messageId).run();
    } catch (e) {
      console.log("Ошибка уведомления получателя " + recipientId + ":", e.message);
    }
  }
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
    "SELECT cm.id, cm.user_id, cm.user_name, cm.text, cm.created_at, cm.edited_at, cm.character_id, cm.character_name, " +
      "cm.character_avatar_file_id, cm.is_attention, cm.photo_file_id, cm.photo_blurred, ch.gender AS character_gender, " +
      "CASE WHEN cm.photo_blurred = 0 OR cm.user_id = ? OR cpr.user_id IS NOT NULL THEN 1 ELSE 0 END AS photo_revealed " +
      "FROM club_messages cm LEFT JOIN characters ch ON ch.id = cm.character_id " +
      "LEFT JOIN club_photo_reveals cpr ON cpr.message_id = cm.id AND cpr.user_id = ? " +
      "WHERE cm.club_id = ? AND (cm.id > ? OR (cm.edited_at IS NOT NULL AND cm.edited_at > ?)) ORDER BY cm.id ASC LIMIT 200"
  ).bind(String(userId), String(userId), clubId, afterId, afterEdit).all();

  const otherRead = await env.DB.prepare(
    "SELECT MIN(last_read_message_id) AS v FROM club_reads WHERE club_id = ? AND user_id != ?"
  ).bind(clubId, String(userId)).first();

  const attention = await env.DB.prepare(
    "SELECT MAX(cm.id) AS v FROM club_messages cm LEFT JOIN club_attention_dismissed cad " +
      "ON cad.club_id = cm.club_id AND cad.user_id = ? " +
      "WHERE cm.club_id = ? AND cm.user_id != ? AND cm.is_attention = 1 AND cm.id > COALESCE(cad.last_dismissed_id, 0)"
  ).bind(String(userId), clubId, String(userId)).first();

  return json({
    messages: results || [],
    other_read_id: (otherRead && otherRead.v != null) ? otherRead.v : 0,
    attention_id: (attention && attention.v != null) ? attention.v : 0,
  });
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
  const photoFileId = body.photo_file_id || null;
  const photoBlurred = photoFileId && body.photo_blurred ? 1 : 0;
  if (!text && !photoFileId) return json({ error: "Пустое сообщение." }, 400);
  if (text.length > 4000) return json({ error: "Слишком длинное сообщение." }, 400);
  if (!characterId) return json({ error: "Сначала выберите персонажа." }, 400);

  const character = await env.DB.prepare("SELECT id, owner_id, name, avatar_file_id, gender FROM characters WHERE id = ?")
    .bind(characterId).first();
  if (!character || String(character.owner_id) !== String(userId)) {
    return json({ error: "Это не ваш персонаж." }, 403);
  }

  const isAttention = isAttentionText(text) ? 1 : 0;

  let message = null;
  try {
    message = await env.DB.prepare(
      "INSERT INTO club_messages (club_id, user_id, user_name, text, character_id, character_name, character_avatar_file_id, is_attention, photo_file_id, photo_blurred) " +
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) " +
        "RETURNING id, user_id, user_name, text, created_at, edited_at, character_id, character_name, character_avatar_file_id, is_attention, photo_file_id, photo_blurred"
    ).bind(clubId, String(userId), userName || null, text, character.id, character.name, character.avatar_file_id, isAttention, photoFileId, photoBlurred).first();
  } catch (e) {
    console.log("Ошибка отправки сообщения:", e.message);
    return json({ error: "Не удалось отправить сообщение." }, 500);
  }
  message.character_gender = character.gender;
  message.photo_revealed = 1;

  context.waitUntil(notifyRecipients(env, clubId, userId, message.id));

  return json({ message: message });
}
