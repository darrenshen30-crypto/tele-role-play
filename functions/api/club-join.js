// functions/api/club-join.js — войти в клуб по пригласительному коду
// (код приходит либо из ссылки t.me/<bot>/<app>?startapp=<код>, либо ручным вводом).

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status: status, headers: { "Content-Type": "application/json" } });
}

export async function onRequestPost(context) {
  const env = context.env;
  const userId = context.data && context.data.tgUserId;
  const userName = context.data && context.data.tgUserName;
  if (!userId) return json({ error: "Не удалось подтвердить пользователя." }, 403);

  const body = await context.request.json();
  const inviteCode = (body.invite_code || "").trim();
  if (!inviteCode) return json({ error: "Введите код приглашения." }, 400);

  const club = await env.DB.prepare(
    "SELECT id, name, invite_code, background_file_id, background_updated_at, music_url, owner_id FROM clubs WHERE invite_code = ?"
  ).bind(inviteCode).first();
  if (!club) return json({ error: "Клуб с таким кодом не найден." }, 404);

  try {
    await env.DB.prepare("INSERT OR IGNORE INTO club_members (club_id, user_id, user_name) VALUES (?, ?, ?)")
      .bind(club.id, String(userId), userName || null).run();
  } catch (e) {
    console.log("Ошибка входа в клуб:", e.message);
    return json({ error: "Не удалось войти в клуб." }, 500);
  }

  return json({ club: club });
}
