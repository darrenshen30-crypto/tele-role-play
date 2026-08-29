// functions/api/club-playback-stop.js — выключить музыку локации (доступно
// любому из двоих, как и смена фона - общая атмосфера, общий контроль).

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status: status, headers: { "Content-Type": "application/json" } });
}

function isOwner(env, id) {
  if (!env.OWNER_ID || !id) return false;
  const ids = String(env.OWNER_ID).split(",").map(function (s) { return s.trim(); }).filter(Boolean);
  return ids.indexOf(String(id)) !== -1;
}

export async function onRequestPost(context) {
  const env = context.env;
  const userId = context.data && context.data.tgUserId;
  if (!isOwner(env, userId)) return json({ error: "Нет доступа." }, 403);

  const body = await context.request.json();
  const clubId = body.club_id;
  if (!clubId) return json({ error: "Не указана локация." }, 400);

  await env.DB.prepare(
    "INSERT INTO club_playback (club_id, state, video_id, initiated_by, start_at) VALUES (?, 'idle', NULL, NULL, NULL) " +
      "ON CONFLICT(club_id) DO UPDATE SET state = 'idle', video_id = NULL, initiated_by = NULL, start_at = NULL"
  ).bind(clubId).run();
  await env.DB.prepare("DELETE FROM club_playback_ready WHERE club_id = ?").bind(clubId).run();

  return json({ state: "idle" });
}
