// functions/api/character.js — редактирование и удаление одного персонажа.
// Только владелец (owner_id) может менять или удалять своего персонажа.

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status: status, headers: { "Content-Type": "application/json" } });
}

function isOwner(env, id) {
  if (!env.OWNER_ID || !id) return false;
  const ids = String(env.OWNER_ID).split(",").map(function (s) { return s.trim(); }).filter(Boolean);
  return ids.indexOf(String(id)) !== -1;
}

const GENDERS = ["alpha", "omega", "gamma"];
function normalizeGender(g) {
  g = (g || "").trim().toLowerCase();
  return GENDERS.indexOf(g) !== -1 ? g : null;
}

export async function onRequestPatch(context) {
  const env = context.env;
  const userId = context.data && context.data.tgUserId;
  if (!isOwner(env, userId)) return json({ error: "Нет доступа." }, 403);

  const id = new URL(context.request.url).searchParams.get("id");
  if (!id) return json({ error: "Не указан персонаж." }, 400);

  const existing = await env.DB.prepare("SELECT id, owner_id, avatar_file_id FROM characters WHERE id = ?").bind(id).first();
  if (!existing) return json({ error: "Персонаж не найден." }, 404);
  if (String(existing.owner_id) !== String(userId)) return json({ error: "Это не ваш персонаж." }, 403);

  const body = await context.request.json();
  const name = (body.name || "").trim();
  const birthdate = (body.birthdate || "").trim();
  const description = (body.description || "").trim();
  const avatarFileId = (body.avatar_file_id || "").trim() || existing.avatar_file_id;
  const gender = normalizeGender(body.gender);
  if (!name) return json({ error: "Введите имя персонажа." }, 400);

  let character = null;
  try {
    character = await env.DB.prepare(
      "UPDATE characters SET name = ?, birthdate = ?, description = ?, avatar_file_id = ?, gender = ? WHERE id = ? " +
        "RETURNING id, name, birthdate, description, avatar_file_id, gender"
    ).bind(name, birthdate || null, description || null, avatarFileId, gender, id).first();
  } catch (e) {
    console.log("Ошибка редактирования персонажа:", e.message);
    return json({ error: "Не удалось сохранить персонажа." }, 500);
  }

  return json({ character: character });
}

export async function onRequestDelete(context) {
  const env = context.env;
  const userId = context.data && context.data.tgUserId;
  if (!isOwner(env, userId)) return json({ error: "Нет доступа." }, 403);

  const id = new URL(context.request.url).searchParams.get("id");
  if (!id) return json({ error: "Не указан персонаж." }, 400);

  const existing = await env.DB.prepare("SELECT id, owner_id FROM characters WHERE id = ?").bind(id).first();
  if (!existing) return json({ error: "Персонаж не найден." }, 404);
  if (String(existing.owner_id) !== String(userId)) return json({ error: "Это не ваш персонаж." }, 403);

  try {
    await env.DB.batch([
      env.DB.prepare("DELETE FROM club_character_choice WHERE character_id = ?").bind(id),
      env.DB.prepare("DELETE FROM characters WHERE id = ?").bind(id),
    ]);
  } catch (e) {
    console.log("Ошибка удаления персонажа:", e.message);
    return json({ error: "Не удалось удалить персонажа." }, 500);
  }

  return json({ ok: true });
}
