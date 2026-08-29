// functions/api/club-playback-force.js — запустить музыку, не дожидаясь всех
// (доступно только тому, кто предложил её включить).

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status: status, headers: { "Content-Type": "application/json" } });
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
