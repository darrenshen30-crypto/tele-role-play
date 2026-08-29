// functions/api/club-playback-stop.js — выключить музыку клуба (доступно
// любому участнику, как и смена фона - общая атмосфера, общий контроль).

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status: status, headers: { "Content-Type": "application/json" } });
}

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

  await env.DB.prepare(
    "INSERT INTO club_playback (club_id, state, video_id, initiated_by, start_at) VALUES (?, 'idle', NULL, NULL, NULL) " +
      "ON CONFLICT(club_id) DO UPDATE SET state = 'idle', video_id = NULL, initiated_by = NULL, start_at = NULL"
  ).bind(clubId).run();
  await env.DB.prepare("DELETE FROM club_playback_ready WHERE club_id = ?").bind(clubId).run();

  return json({ state: "idle" });
}
