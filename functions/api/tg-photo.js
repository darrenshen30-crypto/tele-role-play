// functions/api/tg-photo.js — отдаёт любую фотографию, хранящуюся в Telegram по
// file_id (аватары персонажей, аватары в сообщениях), как обычную картинку.
// Тот же приём, что и club-bg-image.js: без него в CSS/<img> нельзя приложить
// заголовок с проверкой Telegram-подписи.
//
// file_id всегда указывает на один и тот же файл (новая загрузка - это всегда
// новый file_id, значит и новый URL) - поэтому ответ можно кэшировать очень
// долго и агрессивно, через общий edge-кэш Cloudflare (Cache API), а не только
// заголовком в браузере. Без этого при открытии чата с десятками сообщений
// каждая аватарка заново делала 2 похода в Telegram (getFile + скачивание) -
// именно это и было причиной долгой загрузки/тормозов при открытии чата.
export async function onRequestGet(context) {
  const env = context.env;
  const fileId = new URL(context.request.url).searchParams.get("file_id");
  if (!fileId) return new Response("Не указан файл.", { status: 400 });

  const cache = caches.default;
  const cacheKey = new Request(context.request.url, context.request);
  const cached = await cache.match(cacheKey);
  if (cached) return cached;

  const getFile = await fetch(
    "https://api.telegram.org/bot" + env.BOT_TOKEN + "/getFile?file_id=" + encodeURIComponent(fileId)
  );
  const fileData = await getFile.json();
  if (!getFile.ok || !fileData.ok) return new Response("Файл недоступен.", { status: 502 });

  const fileUrl = "https://api.telegram.org/file/bot" + env.BOT_TOKEN + "/" + fileData.result.file_path;
  const fileResp = await fetch(fileUrl);
  if (!fileResp.ok) return new Response("Файл недоступен.", { status: 502 });

  const body = await fileResp.arrayBuffer();
  const response = new Response(body, {
    headers: {
      "Content-Type": fileResp.headers.get("content-type") || "image/jpeg",
      "Cache-Control": "public, max-age=2592000, immutable",
    },
  });
  context.waitUntil(cache.put(cacheKey, response.clone()));
  return response;
}
