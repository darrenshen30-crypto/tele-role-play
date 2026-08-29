// functions/api/club-bg-image.js — отдаёт текущее фон-фото клуба как обычную
// картинку, чтобы можно было подставить в CSS background-image (туда нельзя
// приложить заголовок с проверкой Telegram-подписи). Публичность тут не хуже,
// чем у публичного хранилища Supabase/R2 в других проектах: адрес не секрет,
// но и не выставлен явно наружу без причины.

export async function onRequestGet(context) {
  const env = context.env;
  const clubId = new URL(context.request.url).searchParams.get("club_id");
  if (!clubId) return new Response("Не указан клуб.", { status: 400 });

  const club = await env.DB.prepare("SELECT background_file_id FROM clubs WHERE id = ?").bind(clubId).first();
  if (!club || !club.background_file_id) return new Response("Нет фона.", { status: 404 });

  const getFile = await fetch(
    "https://api.telegram.org/bot" + env.BOT_TOKEN + "/getFile?file_id=" + encodeURIComponent(club.background_file_id)
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
