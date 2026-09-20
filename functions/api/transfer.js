// functions/api/transfer.js — "перевести деньги" другому персонажу в чате
// локации. Как и звонок (см. call.js), это специальная строка в
// club_messages (transfer_to_character_id + transfer_amount_cents вместо
// call_to_character_id/dice_value/gift_key), которую клиент всегда рендерит
// обычным пузырём в ленте (в отличие от звонка, тут нет всплывающего
// оповещения - только постоянная запись, видная обоим).

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
  const userName = context.data && context.data.tgUserName;
  if (!isOwner(env, userId)) return json({ error: "Нет доступа." }, 403);

  const clubId = new URL(context.request.url).searchParams.get("club_id");
  if (!clubId) return json({ error: "Не указана локация." }, 400);

  const body = await context.request.json();
  const characterId = body.character_id;
  const transferToCharacterId = body.transfer_to_character_id;
  const amount = Number(body.amount);
  if (!characterId) return json({ error: "Сначала выберите, от чьего имени переводить." }, 400);
  if (!transferToCharacterId) return json({ error: "Выберите, кому перевести." }, 400);
  if (!amount || !isFinite(amount) || amount <= 0) return json({ error: "Укажите сумму перевода." }, 400);
  if (amount > 1000000) return json({ error: "Слишком большая сумма." }, 400);

  const character = await env.DB.prepare("SELECT id, owner_id, name, avatar_file_id, gender FROM characters WHERE id = ?")
    .bind(characterId).first();
  if (!character || String(character.owner_id) !== String(userId)) {
    return json({ error: "Это не ваш персонаж." }, 403);
  }

  const target = await env.DB.prepare("SELECT id, owner_id, name FROM characters WHERE id = ?").bind(transferToCharacterId).first();
  if (!target) return json({ error: "Персонаж не найден." }, 404);
  if (String(target.owner_id) === String(userId)) return json({ error: "Нельзя перевести самому себе." }, 400);

  const amountCents = Math.round(amount * 100);

  let message = null;
  try {
    message = await env.DB.prepare(
      "INSERT INTO club_messages (club_id, user_id, user_name, text, character_id, character_name, character_avatar_file_id, transfer_to_character_id, transfer_amount_cents) " +
        "VALUES (?, ?, ?, '', ?, ?, ?, ?, ?) " +
        "RETURNING id, user_id, user_name, text, created_at, edited_at, character_id, character_name, character_avatar_file_id, transfer_to_character_id, transfer_amount_cents"
    ).bind(clubId, String(userId), userName || null, character.id, character.name, character.avatar_file_id, target.id, amountCents).first();
  } catch (e) {
    console.log("Ошибка перевода:", e.message);
    return json({ error: "Не удалось перевести." }, 500);
  }
  message.character_gender = character.gender;
  message.photo_revealed = 1;

  return json({ message: message, transfer_target_name: target.name });
}
