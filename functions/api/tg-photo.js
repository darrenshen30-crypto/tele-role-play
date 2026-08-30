// functions/api/tg-photo.js — отдаёт любую фотографию, хранящуюся в Telegram по
// file_id (аватары персонажей, аватары в сообщениях), как обычную картинку.
// Тот же приём, что и club-bg-image.js: без него в CSS/<img> нельзя приложить
// заголовок с проверкой Telegram-подписи.

export async function onRequestGet(context) {
  const env = context.env;
  const fileId = new URL(context.request.url).searchParams.get("file_id");
  if (!fileId) return new Response("Не указан файл.", { status: 400 });

  const getFile = await fetch(
    "https://api.telegram.org/bot" + env.BOT_TOKEN + "/getFile?file_id=" + encodeURIComponent(fileId)
  );
  const fileData = await getFile.json();
  if (!getFile.ok || !fileData.ok) return new Response("Файл недоступен.", { status: 502 });

  const fileUrl = "https://api.telegram.org/file/bot" + env.BOT_TOKEN + "/" + fileData.result.file_path;
  const fileResp = await fetch(fileUrl);
  if (!fileResp.ok) return new Response("Файл недоступен.", { status: 502 });

  return new Response(fileResp.body, {
    headers: {
      "Content-Type": fileResp.headers.get("content-type") || "image/jpeg",
      "Cache-Control": "public, max-age=300",
    },
  });
}
