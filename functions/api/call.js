// functions/api/call.js — "позвонить" другому персонажу из чата локации.
// Чисто визуальное уведомление (см. index.html: showIncomingCallOverlay) -
// нет ни аудио, ни отдельной сессии звонка, только специальная строка в
// club_messages (call_to_character_id вместо dice_value/gift_key), которую
// получатель увидит через обычный опрос /api/messages, пока сам находится в
// этой же комнате. Никакого пуша в Telegram нарочно не шлём - оповещение
// работает только "здесь и сейчас", как договорились с пользователем.

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
  const callToCharacterId = body.call_to_character_id;
  if (!characterId) return json({ error: "Сначала выберите, от чьего имени звонить." }, 400);
  if (!callToCharacterId) return json({ error: "Выберите, кому звонить." }, 400);

  const character = await env.DB.prepare("SELECT id, owner_id, name, avatar_file_id, gender FROM characters WHERE id = ?")
    .bind(characterId).first();
  if (!character || String(character.owner_id) !== String(userId)) {
    return json({ error: "Это не ваш персонаж." }, 403);
  }

  const target = await env.DB.prepare("SELECT id, owner_id, name FROM characters WHERE id = ?").bind(callToCharacterId).first();
  if (!target) return json({ error: "Персонаж не найден." }, 404);
  if (String(target.owner_id) === String(userId)) return json({ error: "Нельзя позвонить своему же персонажу." }, 400);

  let message = null;
  try {
    message = await env.DB.prepare(
      "INSERT INTO club_messages (club_id, user_id, user_name, text, character_id, character_name, character_avatar_file_id, call_to_character_id) " +
        "VALUES (?, ?, ?, '', ?, ?, ?, ?) " +
        "RETURNING id, user_id, user_name, text, created_at, edited_at, character_id, character_name, character_avatar_file_id, call_to_character_id"
    ).bind(clubId, String(userId), userName || null, character.id, character.name, character.avatar_file_id, target.id).first();
  } catch (e) {
    console.log("Ошибка звонка:", e.message);
    return json({ error: "Не удалось позвонить." }, 500);
  }
  message.character_gender = character.gender;
  message.photo_revealed = 1;

  return json({ message: message, call_to_name: target.name });
}
