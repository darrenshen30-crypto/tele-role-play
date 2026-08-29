// functions/api/club-playback.js — текущее состояние синхронного проигрывания
// музыки в локации. Опрашивается фронтендом каждые ~2.5 сек, как и сообщения.
// Состояния: idle (тишина) -> waiting (кто-то предложил включить, ждём
// подтверждения второго человека) -> playing (стартовало у всех в момент start_at).

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

export async function onRequestGet(context) {
  const env = context.env;
  const userId = context.data && context.data.tgUserId;
  if (!isOwner(env, userId)) return json({ error: "Нет доступа." }, 403);

  const clubId = new URL(context.request.url).searchParams.get("club_id");
  if (!clubId) return json({ error: "Не указана локация." }, 400);

  const playback = await env.DB.prepare(
    "SELECT club_id, video_id, state, initiated_by, start_at FROM club_playback WHERE club_id = ?"
  ).bind(clubId).first();

  const readyRows = await env.DB.prepare("SELECT user_id FROM club_playback_ready WHERE club_id = ?").bind(clubId).all();

  return json({
    state: (playback && playback.state) || "idle",
    video_id: playback ? playback.video_id : null,
    initiated_by: playback ? playback.initiated_by : null,
    start_at: playback ? playback.start_at : null,
    total_members: totalAllowed(env),
    ready_user_ids: (readyRows.results || []).map(function (r) { return r.user_id; }),
  });
}
