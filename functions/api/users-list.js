// functions/api/users-list.js — список людей, у которых есть хотя бы один
// персонаж (то есть реальных участников, а не всех, кто просто есть в
// OWNER_ID - например, аккаунт только для просмотра туда не попадёт, пока
// не заведёт себе персонажа), кроме самого запрашивающего - себя самого в
// этом списке видеть незачем (фильтр по server-verified userId, а не на
// клиенте, чтобы не зависеть от tg.initDataUnsafe).

const ONLINE_WINDOW_MS = 60000;

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

  const { results } = await env.DB.prepare(
    "SELECT ch.owner_id AS user_id, up.display_name, up.name, up.avatar_file_id, up.photo_url, up.last_seen " +
      "FROM (SELECT DISTINCT owner_id FROM characters WHERE owner_id != ?) ch " +
      "LEFT JOIN user_presence up ON up.user_id = ch.owner_id " +
      "ORDER BY ch.owner_id"
  ).bind(String(userId)).all();

  const now = Date.now();
  const users = (results || []).map(function (row) {
    const lastSeenMs = row.last_seen ? new Date(row.last_seen).getTime() : 0;
    return {
      user_id: row.user_id,
      name: row.display_name || row.name || ("Пользователь " + row.user_id),
      photo_url: row.avatar_file_id ? ("/api/tg-photo?file_id=" + encodeURIComponent(row.avatar_file_id)) : (row.photo_url || null),
      online: lastSeenMs > 0 && (now - lastSeenMs) < ONLINE_WINDOW_MS,
    };
  });

  return json({ users: users });
}
