// functions/api/club.js — детали одного клуба и обновление ссылки на музыку.
// Изменение фона живёт отдельно, в club-background.js (там бинарная загрузка файла в R2).

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

  const id = new URL(context.request.url).searchParams.get("id");
  if (!id) return json({ error: "Не указан клуб." }, 400);
  if (!(await isMember(env, id, userId))) return json({ error: "Вы не в этом клубе." }, 403);

  const club = await env.DB.prepare(
    "SELECT id, name, invite_code, background_file_id, background_updated_at, music_url, owner_id FROM clubs WHERE id = ?"
  ).bind(id).first();
  if (!club) return json({ error: "Клуб не найден." }, 404);
  return json({ club: club });
}

export async function onRequestPost(context) {
  const env = context.env;
  const userId = context.data && context.data.tgUserId;
  if (!userId) return json({ error: "Не удалось подтвердить пользователя." }, 403);

  const id = new URL(context.request.url).searchParams.get("id");
  if (!id) return json({ error: "Не указан клуб." }, 400);
  if (!(await isMember(env, id, userId))) return json({ error: "Вы не в этом клубе." }, 403);

  const body = await context.request.json();
  const musicUrl = (body.music_url || "").trim();

  try {
    await env.DB.prepare("UPDATE clubs SET music_url = ? WHERE id = ?").bind(musicUrl || null, id).run();
  } catch (e) {
    console.log("Ошибка сохранения музыки:", e.message);
    return json({ error: "Не удалось сохранить ссылку на музыку." }, 500);
  }
  return json({ ok: true });
}
