// functions/api/message-photo.js — загрузить фото для сообщения в комнате.
// Как и с аватаром персонажа, фото отправляется через Telegram Bot API самому
// загрузившему (sendPhoto), взамен получаем file_id. Привязка к сообщению
// происходит отдельным запросом (отправка сообщения), потому что до отправки
// у сообщения ещё нет id.

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
  form.append("caption", "Фото для сообщения в комнате.");
  form.append("photo", new Blob([bytes], { type: contentType }), "photo.jpg");

  const send = await fetch("https://api.telegram.org/bot" + env.BOT_TOKEN + "/sendPhoto", {
    method: "POST",
    body: form,
  });
  const sendData = await send.json();
  if (!send.ok || !sendData.ok) {
    console.log("Ошибка отправки фото в Telegram:", JSON.stringify(sendData));
    return json({ error: "Не удалось загрузить фото." }, 500);
  }
  const sizes = sendData.result.photo || [];
  const biggest = sizes[sizes.length - 1];
  if (!biggest) return json({ error: "Telegram не вернул фото." }, 500);

  return json({ photo_file_id: biggest.file_id });
}
