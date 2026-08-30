// functions/api/character-photo.js — загрузить фото аватара персонажа.
// Как и фон локации, фото отправляется через Telegram Bot API самому
// загрузившему (sendPhoto), взамен получаем file_id - без него не нужен ни
// Supabase, ни R2. Возвращает голый file_id, привязка к персонажу происходит
// отдельным запросом (создание/редактирование персонажа), потому что при
// создании персонажа ещё нет его id, а карточка обязана быть с фото сразу.

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status: status, headers: { "Content-Type": "application/json" } });
}

function isOwner(env, id) {
  if (!env.OWNER_ID || !id) return false;
  const ids = String(env.OWNER_ID).split(",").map(function (s) { return s.trim(); }).filter(Boolean);
  return ids.indexOf(String(id)) !== -1;
}

const MAX_BYTES = 10 * 1024 * 1024;

export async function onRequestPost(context) {
  const env = context.env;
  const userId = context.data && context.data.tgUserId;
  if (!isOwner(env, userId)) return json({ error: "Нет доступа." }, 403);

  const contentType = context.request.headers.get("content-type") || "image/jpeg";
  if (contentType.indexOf("image/") !== 0) return json({ error: "Это не похоже на фото." }, 400);
  const bytes = await context.request.arrayBuffer();
  if (!bytes.byteLength) return json({ error: "Пустой файл." }, 400);
  if (bytes.byteLength > MAX_BYTES) return json({ error: "Фото слишком большое (максимум 10 МБ)." }, 400);

  const form = new FormData();
  form.append("chat_id", String(userId));
  form.append("caption", "Аватар персонажа.");
  form.append("photo", new Blob([bytes], { type: contentType }), "avatar.jpg");

  const send = await fetch("https://api.telegram.org/bot" + env.BOT_TOKEN + "/sendPhoto", {
    method: "POST",
    body: form,
  });
  const sendData = await send.json();
  if (!send.ok || !sendData.ok) {
    console.log("Ошибка отправки аватара в Telegram:", JSON.stringify(sendData));
    return json({ error: "Не удалось загрузить фото." }, 500);
  }
  const sizes = sendData.result.photo || [];
  const biggest = sizes[sizes.length - 1];
  if (!biggest) return json({ error: "Telegram не вернул фото." }, 500);

  return json({ avatar_file_id: biggest.file_id });
}
