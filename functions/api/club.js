// functions/api/club.js — детали одной локации и обновление ссылки на музыку.
// Изменение фона живёт отдельно, в club-background.js.

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

  const id = new URL(context.request.url).searchParams.get("id");
  if (!id) return json({ error: "Не указана локация." }, 400);

  const club = await env.DB.prepare(
    "SELECT id, name, category, background_file_id, background_updated_at, music_url, owner_id FROM clubs WHERE id = ?"
  ).bind(id).first();
  if (!club) return json({ error: "Локация не найдена." }, 404);
  return json({ club: club });
}

export async function onRequestPost(context) {
  const env = context.env;
  const userId = context.data && context.data.tgUserId;
  if (!isOwner(env, userId)) return json({ error: "Нет доступа." }, 403);

  const id = new URL(context.request.url).searchParams.get("id");
  if (!id) return json({ error: "Не указана локация." }, 400);

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
