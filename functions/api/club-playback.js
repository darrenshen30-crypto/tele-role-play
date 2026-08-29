// functions/api/club-playback.js — текущее состояние синхронного проигрывания
// музыки в клубе. Опрашивается фронтендом каждые ~2.5 сек, как и сообщения.
// Состояния: idle (тишина) -> waiting (кто-то предложил включить, ждём
// подтверждения остальных) -> playing (стартовало у всех в момент start_at).

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

  const clubId = new URL(context.request.url).searchParams.get("club_id");
  if (!clubId) return json({ error: "Не указан клуб." }, 400);
  if (!(await isMember(env, clubId, userId))) return json({ error: "Вы не в этом клубе." }, 403);

  const playback = await env.DB.prepare(
    "SELECT club_id, video_id, state, initiated_by, start_at FROM club_playback WHERE club_id = ?"
  ).bind(clubId).first();

  const totalRow = await env.DB.prepare("SELECT COUNT(*) AS n FROM club_members WHERE club_id = ?").bind(clubId).first();
  const readyRows = await env.DB.prepare("SELECT user_id FROM club_playback_ready WHERE club_id = ?").bind(clubId).all();

  return json({
    state: (playback && playback.state) || "idle",
    video_id: playback ? playback.video_id : null,
    initiated_by: playback ? playback.initiated_by : null,
    start_at: playback ? playback.start_at : null,
    total_members: totalRow ? totalRow.n : 0,
    ready_user_ids: (readyRows.results || []).map(function (r) { return r.user_id; }),
  });
}
