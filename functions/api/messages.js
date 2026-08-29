// functions/api/messages.js — история сообщений клуба и отправка новых.
// Живой эффект чата даёт короткий опрос (poll) с фронтенда каждые пару секунд -
// без вебсокетов, чтобы не заводить отдельное realtime-соединение.

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status: status, headers: { "Content-Type": "application/json" } });
}

async function isMember(env, clubId, userId) {
  const row = await env.DB.prepare("SELECT 1 FROM club_members WHERE club_id = ? AND user_id = ?")
    .bind(clubId, String(userId)).first();
  return !!row;
}

export async function onRequestGet(context) {
  const env = context.env;
  const userId = context.data && context.data.tgUserId;
  if (!userId) return json({ error: "Не удалось подтвердить пользователя." }, 403);

  const params = new URL(context.request.url).searchParams;
  const clubId = params.get("club_id");
  const afterId = params.get("after_id") || "0";
  if (!clubId) return json({ error: "Не указан клуб." }, 400);
  if (!(await isMember(env, clubId, userId))) return json({ error: "Вы не в этом клубе." }, 403);

  const { results } = await env.DB.prepare(
    "SELECT id, user_id, user_name, text, created_at FROM club_messages " +
      "WHERE club_id = ? AND id > ? ORDER BY id ASC LIMIT 200"
  ).bind(clubId, afterId).all();

  return json({ messages: results || [] });
}

export async function onRequestPost(context) {
  const env = context.env;
  const userId = context.data && context.data.tgUserId;
  const userName = context.data && context.data.tgUserName;
  if (!userId) return json({ error: "Не удалось подтвердить пользователя." }, 403);

  const clubId = new URL(context.request.url).searchParams.get("club_id");
  if (!clubId) return json({ error: "Не указан клуб." }, 400);
  if (!(await isMember(env, clubId, userId))) return json({ error: "Вы не в этом клубе." }, 403);

  const body = await context.request.json();
  const text = (body.text || "").trim();
  if (!text) return json({ error: "Пустое сообщение." }, 400);
  if (text.length > 4000) return json({ error: "Слишком длинное сообщение." }, 400);

  let message = null;
  try {
    message = await env.DB.prepare(
      "INSERT INTO club_messages (club_id, user_id, user_name, text) VALUES (?, ?, ?, ?) " +
        "RETURNING id, user_id, user_name, text, created_at"
    ).bind(clubId, String(userId), userName || null, text).first();
  } catch (e) {
    console.log("Ошибка отправки сообщения:", e.message);
    return json({ error: "Не удалось отправить сообщение." }, 500);
  }
  return json({ message: message });
}
