// functions/api/club-checkin.js — "отметиться" в локации своим персонажем.
// Это отдельная, чисто ролевая метка "персонаж сейчас здесь" - не путать с
// club_character_choice (от чьего лица говоришь в чате этой же локации).
// Один персонаж - одна локация одновременно: PRIMARY KEY по character_id +
// upsert сам снимает отметку с прежней локации при переходе в новую.
// Явный выход не обязателен - отметки сами угасают через сутки без действий
// (см. CHECKIN_TTL_HOURS ниже и в clubs.js), чтобы не заставлять
// отмечаться/выходить при каждом сворачивании приложения.

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status: status, headers: { "Content-Type": "application/json" } });
}

function isOwner(env, id) {
  if (!env.OWNER_ID || !id) return false;
  const ids = String(env.OWNER_ID).split(",").map(function (s) { return s.trim(); }).filter(Boolean);
  return ids.indexOf(String(id)) !== -1;
}

const CHECKIN_TTL_HOURS = 24;

export async function onRequestGet(context) {
  const env = context.env;
  const userId = context.data && context.data.tgUserId;
  if (!isOwner(env, userId)) return json({ error: "Нет доступа." }, 403);

  const clubId = new URL(context.request.url).searchParams.get("club_id");
  if (!clubId) return json({ error: "Не указана локация." }, 400);

  const { results } = await env.DB.prepare(
    "SELECT character_id FROM club_checkins WHERE club_id = ? AND checked_in_at > datetime('now', '-" + CHECKIN_TTL_HOURS + " hours')"
  ).bind(clubId).all();
  return json({ character_ids: (results || []).map(function (r) { return r.character_id; }) });
}

export async function onRequestPost(context) {
  const env = context.env;
  const userId = context.data && context.data.tgUserId;
  if (!isOwner(env, userId)) return json({ error: "Нет доступа." }, 403);

  const body = await context.request.json();
  const clubId = body.club_id;
  const characterId = body.character_id;
  if (!clubId || !characterId) return json({ error: "Не хватает данных." }, 400);

  const character = await env.DB.prepare("SELECT id, owner_id FROM characters WHERE id = ?").bind(characterId).first();
  if (!character || String(character.owner_id) !== String(userId)) {
    return json({ error: "Это не ваш персонаж." }, 403);
  }

  try {
    await env.DB.prepare(
      "INSERT INTO club_checkins (character_id, club_id, checked_in_at) VALUES (?, ?, datetime('now')) " +
        "ON CONFLICT(character_id) DO UPDATE SET club_id = excluded.club_id, checked_in_at = excluded.checked_in_at"
    ).bind(characterId, clubId).run();
  } catch (e) {
    console.log("Ошибка чекина:", e.message);
    return json({ error: "Не удалось отметиться." }, 500);
  }
  return json({ ok: true });
}

export async function onRequestDelete(context) {
  const env = context.env;
  const userId = context.data && context.data.tgUserId;
  if (!isOwner(env, userId)) return json({ error: "Нет доступа." }, 403);

  const characterId = new URL(context.request.url).searchParams.get("character_id");
  if (!characterId) return json({ error: "Не указан персонаж." }, 400);

  const character = await env.DB.prepare("SELECT id, owner_id FROM characters WHERE id = ?").bind(characterId).first();
  if (!character || String(character.owner_id) !== String(userId)) {
    return json({ error: "Это не ваш персонаж." }, 403);
  }

  await env.DB.prepare("DELETE FROM club_checkins WHERE character_id = ?").bind(characterId).run();
  return json({ ok: true });
}
