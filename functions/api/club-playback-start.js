// functions/api/club-playback-start.js — предложить включить музыку клуба.
// Если участник в клубе один - запускается сразу. Иначе уходим в состояние
// "waiting", пока каждый не подтвердит через club-playback-ready.js.

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status: status, headers: { "Content-Type": "application/json" } });
}

function extractYouTubeId(url) {
  if (!url) return null;
  const m = String(url).match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|shorts\/))([A-Za-z0-9_-]{6,})/);
  return m ? m[1] : null;
}

const START_BUFFER_MS = 2500;

async function isMember(env, clubId, userId) {
  const row = await env.DB.prepare("SELECT 1 FROM club_members WHERE club_id = ? AND user_id = ?")
    .bind(clubId, String(userId)).first();
  return !!row;
}

export async function onRequestPost(context) {
  const env = context.env;
  const userId = context.data && context.data.tgUserId;
  if (!userId) return json({ error: "Не удалось подтвердить пользователя." }, 403);

  const body = await context.request.json();
  const clubId = body.club_id;
  if (!clubId) return json({ error: "Не указан клуб." }, 400);
  if (!(await isMember(env, clubId, userId))) return json({ error: "Вы не в этом клубе." }, 403);

  const existing = await env.DB.prepare("SELECT state FROM club_playback WHERE club_id = ?").bind(clubId).first();
  if (existing && existing.state !== "idle") {
    return json({ error: "Музыка уже запускается или играет." }, 409);
  }

  const club = await env.DB.prepare("SELECT music_url FROM clubs WHERE id = ?").bind(clubId).first();
  const videoId = club && extractYouTubeId(club.music_url);
  if (!videoId) return json({ error: "Ссылка на музыку не задана в настройках клуба." }, 400);

  const totalRow = await env.DB.prepare("SELECT COUNT(*) AS n FROM club_members WHERE club_id = ?").bind(clubId).first();
  const totalMembers = totalRow ? totalRow.n : 1;

  await env.DB.prepare("DELETE FROM club_playback_ready WHERE club_id = ?").bind(clubId).run();
  await env.DB.prepare("INSERT INTO club_playback_ready (club_id, user_id) VALUES (?, ?)").bind(clubId, String(userId)).run();

  const soloReady = totalMembers <= 1;
  const startAt = soloReady ? new Date(Date.now() + START_BUFFER_MS).toISOString() : null;
  const state = soloReady ? "playing" : "waiting";

  await env.DB.prepare(
    "INSERT INTO club_playback (club_id, video_id, state, initiated_by, start_at) VALUES (?, ?, ?, ?, ?) " +
      "ON CONFLICT(club_id) DO UPDATE SET video_id = excluded.video_id, state = excluded.state, " +
      "initiated_by = excluded.initiated_by, start_at = excluded.start_at"
  ).bind(clubId, videoId, state, String(userId), startAt).run();

  return json({ state: state, video_id: videoId, start_at: startAt });
}
