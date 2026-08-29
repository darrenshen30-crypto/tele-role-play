// functions/api/club-background.js — загрузить/заменить фон-фото локации.
// Фото не хранится ни в Supabase, ни в R2 (чтобы не заводить карту) - оно
// отправляется через Telegram Bot API самому загрузившему (sendPhoto), а
// Telegram даёт взамен file_id. Показываем фон позже через club-bg-image.js,
// который каждый раз запрашивает у Telegram свежую ссылку на файл по этому id.

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

  const id = new URL(context.request.url).searchParams.get("id");
  if (!id) return json({ error: "Не указана локация." }, 400);

  const club = await env.DB.prepare("SELECT id, name FROM clubs WHERE id = ?").bind(id).first();
  if (!club) return json({ error: "Локация не найдена." }, 404);

  const contentType = context.request.headers.get("content-type") || "image/jpeg";
  if (contentType.indexOf("image/") !== 0) return json({ error: "Это не похоже на фото." }, 400);
  const bytes = await context.request.arrayBuffer();
  if (!bytes.byteLength) return json({ error: "Пустой файл." }, 400);
  if (bytes.byteLength > MAX_BYTES) return json({ error: "Фото слишком большое (максимум 10 МБ)." }, 400);

  const form = new FormData();
  form.append("chat_id", String(userId));
  form.append("caption", "Фон локации «" + club.name + "» сохранён.");
  form.append("photo", new Blob([bytes], { type: contentType }), "background.jpg");

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

  const updatedAt = new Date().toISOString();
  try {
    await env.DB.prepare("UPDATE clubs SET background_file_id = ?, background_updated_at = ? WHERE id = ?")
      .bind(biggest.file_id, updatedAt, id).run();
  } catch (e) {
    console.log("Ошибка сохранения фона:", e.message);
    return json({ error: "Фото загружено, но не удалось привязать к локации." }, 500);
  }

  return json({ background_file_id: biggest.file_id, background_updated_at: updatedAt });
}
