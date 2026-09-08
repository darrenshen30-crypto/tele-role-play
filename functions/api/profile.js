// functions/api/profile.js — собственный профиль пользователя (псевдоним и
// аватар, показываются другим вместо настоящего имени/фото из Telegram,
// см. user_presence). GET отдаёт текущее состояние, POST сохраняет.

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

  const row = await env.DB.prepare(
    "SELECT display_name, avatar_file_id FROM user_presence WHERE user_id = ?"
  ).bind(String(userId)).first();

  return json({
    profile: {
      display_name: (row && row.display_name) || null,
      avatar_file_id: (row && row.avatar_file_id) || null,
    },
  });
}

export async function onRequestPost(context) {
  const env = context.env;
  const userId = context.data && context.data.tgUserId;
  if (!isOwner(env, userId)) return json({ error: "Нет доступа." }, 403);

  const body = await context.request.json();
  const displayName = (body.display_name || "").trim();
  const avatarFileId = body.avatar_file_id || null;
  if (!displayName) return json({ error: "Введите псевдоним." }, 400);
  if (displayName.length > 40) return json({ error: "Слишком длинный псевдоним." }, 400);

  try {
    await env.DB.prepare(
      "INSERT INTO user_presence (user_id, display_name, avatar_file_id) VALUES (?, ?, ?) " +
        "ON CONFLICT(user_id) DO UPDATE SET display_name = excluded.display_name, avatar_file_id = excluded.avatar_file_id"
    ).bind(String(userId), displayName, avatarFileId).run();
  } catch (e) {
    console.log("Ошибка сохранения профиля:", e.message);
    return json({ error: "Не удалось сохранить профиль." }, 500);
  }

  return json({ profile: { display_name: displayName, avatar_file_id: avatarFileId } });
}
