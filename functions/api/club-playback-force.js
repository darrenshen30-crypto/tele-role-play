// functions/api/club-playback-force.js — запустить музыку, не дожидаясь
// второго человека (доступно только тому, кто предложил её включить).

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status: status, headers: { "Content-Type": "application/json" } });
}

function isOwner(env, id) {
  if (!env.OWNER_ID || !id) return false;
  const ids = String(env.OWNER_ID).split(",").map(function (s) { return s.trim(); }).filter(Boolean);
  return ids.indexOf(String(id)) !== -1;
}

const START_BUFFER_MS = 2500;

export async function onRequestPost(context) {
  const env = context.env;
  const userId = context.data && context.data.tgUserId;
  if (!isOwner(env, userId)) return json({ error: "Нет доступа." }, 403);

  const body = await context.request.json();
  const clubId = body.club_id;
  if (!clubId) return json({ error: "Не указана локация." }, 400);

  const playback = await env.DB.prepare("SELECT state, video_id, initiated_by FROM club_playback WHERE club_id = ?")
    .bind(clubId).first();
  if (!playback || playback.state !== "waiting") return json({ error: "Сейчас нечего запускать." }, 409);
  if (String(playback.initiated_by) !== String(userId)) {
    return json({ error: "Запустить досрочно может только тот, кто предложил музыку." }, 403);
  }

  const startAt = new Date(Date.now() + START_BUFFER_MS).toISOString();
  await env.DB.prepare("UPDATE club_playback SET state = 'playing', start_at = ? WHERE club_id = ?")
    .bind(startAt, clubId).run();

  return json({ state: "playing", video_id: playback.video_id, start_at: startAt });
}
