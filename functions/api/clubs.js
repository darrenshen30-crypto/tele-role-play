// functions/api/clubs.js — список клубов текущего пользователя и создание клуба.
// База данных - Cloudflare D1 (биндинг env.DB), без Supabase.

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status: status, headers: { "Content-Type": "application/json" } });
}

function randomInviteCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return Array.from(bytes).map(function (b) { return b.toString(36); }).join("").slice(0, 8);
}

export async function onRequestGet(context) {
  const env = context.env;
  const userId = context.data && context.data.tgUserId;
  if (!userId) return json({ error: "Не удалось подтвердить пользователя." }, 403);

  const { results } = await env.DB.prepare(
    "SELECT c.id, c.name, c.invite_code, c.background_file_id, c.background_updated_at, c.music_url, c.owner_id " +
      "FROM club_members m JOIN clubs c ON c.id = m.club_id " +
      "WHERE m.user_id = ? ORDER BY m.joined_at DESC"
  ).bind(String(userId)).all();

  return json({ clubs: results || [] });
}

export async function onRequestPost(context) {
  const env = context.env;
  const userId = context.data && context.data.tgUserId;
  const userName = context.data && context.data.tgUserName;
  if (!userId) return json({ error: "Не удалось подтвердить пользователя." }, 403);

  const body = await context.request.json();
  const name = (body.name || "").trim();
  if (!name) return json({ error: "Введите название клуба." }, 400);

  let club = null;
  for (let attempt = 0; attempt < 3 && !club; attempt++) {
    const inviteCode = randomInviteCode();
    try {
      club = await env.DB.prepare(
        "INSERT INTO clubs (name, invite_code, owner_id) VALUES (?, ?, ?) RETURNING id, name, invite_code, background_file_id, background_updated_at, music_url, owner_id"
      ).bind(name, inviteCode, String(userId)).first();
    } catch (e) {
      if (String(e.message || "").indexOf("UNIQUE") === -1) {
        console.log("Ошибка создания клуба:", e.message);
        return json({ error: "Не удалось создать клуб." }, 500);
      }
    }
  }
  if (!club) return json({ error: "Не удалось создать клуб, попробуйте ещё раз." }, 500);

  try {
    await env.DB.prepare("INSERT INTO club_members (club_id, user_id, user_name) VALUES (?, ?, ?)")
      .bind(club.id, String(userId), userName || null).run();
  } catch (e) {
    console.log("Ошибка добавления создателя в клуб:", e.message);
    return json({ error: "Клуб создан, но не удалось войти в него." }, 500);
  }

  return json({ club: club });
}
