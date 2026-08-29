// functions/api/club-playback-ready.js — подтвердить готовность слушать музыку.
// Когда готовы оба разрешённых пользователя, всем назначается одно и то же
// время старта.

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status: status, headers: { "Content-Type": "application/json" } });
}

function isOwner(env, id) {
  if (!env.OWNER_ID || !id) return false;
  const ids = String(env.OWNER_ID).split(",").map(function (s) { return s.trim(); }).filter(Boolean);
  return ids.indexOf(String(id)) !== -1;
}

function totalAllowed(env) {
  if (!env.OWNER_ID) return 1;
  return String(env.OWNER_ID).split(",").map(function (s) { return s.trim(); }).filter(Boolean).length;
}

const START_BUFFER_MS = 2500;

export async function onRequestPost(context) {
  const env = context.env;
  const userId = context.data && context.data.tgUserId;
  if (!isOwner(env, userId)) return json({ error: "Нет доступа." }, 403);

  const body = await context.request.json();
  const clubId = body.club_id;
  if (!clubId) return json({ error: "Не указана локация." }, 400);

  const playback = await env.DB.prepare("SELECT state, video_id FROM club_playback WHERE club_id = ?").bind(clubId).first();
  if (!playback || playback.state !== "waiting") {
    return json({ error: "Сейчас никто не предлагает включить музыку." }, 409);
  }

  await env.DB.prepare("INSERT OR IGNORE INTO club_playback_ready (club_id, user_id) VALUES (?, ?)")
    .bind(clubId, String(userId)).run();

  const totalMembers = totalAllowed(env);
  const readyRow = await env.DB.prepare("SELECT COUNT(*) AS n FROM club_playback_ready WHERE club_id = ?").bind(clubId).first();

  if (readyRow.n >= totalMembers) {
    const startAt = new Date(Date.now() + START_BUFFER_MS).toISOString();
    await env.DB.prepare("UPDATE club_playback SET state = 'playing', start_at = ? WHERE club_id = ?")
      .bind(startAt, clubId).run();
    return json({ state: "playing", video_id: playback.video_id, start_at: startAt });
  }

  return json({ state: "waiting", ready_count: readyRow.n, total_members: totalMembers });
}
