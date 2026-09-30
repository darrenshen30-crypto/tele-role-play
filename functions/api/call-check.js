// functions/api/call-check.js — глобальная проверка "не звонят ли мне прямо
// сейчас", не привязанная к конкретной локации. Обычный опрос сообщений
// (messages.js) ловит входящий звонок только пока получатель уже сидит в той
// же комнате - если его там нет (другой экран, другая локация, приложение
// свёрнуто), звонок иначе долетит до него только пуш-уведомлением от бота, а
// по факту открытия той же локации это будет initial=1, и всплывающее окно
// уже не показывается (см. index.html: !isInitialLoad) - трель и кнопки
// принять/отклонить так и не появятся. Этот эндпоинт опрашивается всегда,
// с любого экрана (см. index.html: pollGlobalCallCheck), и намеренно не
// привязан к club_id.
//
// "Живым" (достойным того, чтобы всплыть и зазвонить) считаем только звонок
// не старше RING_WINDOW_MS - иначе, открыв приложение спустя долгое время,
// пользователь получил бы неожиданный рингтон по давно пропущенному звонку.

const RING_WINDOW_MS = 45000;

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status: status, headers: { "Content-Type": "application/json" } });
}

function isOwner(env, id) {
  if (!env.OWNER_ID || !id) return false;
  const ids = String(env.OWNER_ID).split(",").map(function (s) { return s.trim(); }).filter(Boolean);
  return ids.indexOf(String(id)) !== -1;
}

export async function onRequestGet(context) {
  const env = context.env;
  const userId = context.data && context.data.tgUserId;
  if (!isOwner(env, userId)) return json({ error: "Нет доступа." }, 403);

  const row = await env.DB.prepare(
    "SELECT cm.id, cm.club_id, cm.user_name, cm.character_name, cm.character_avatar_file_id, cm.created_at " +
      "FROM club_messages cm JOIN characters callee ON callee.id = cm.call_to_character_id " +
      "WHERE callee.owner_id = ? AND cm.call_response IS NULL " +
      "ORDER BY cm.id DESC LIMIT 1"
  ).bind(String(userId)).first();

  if (!row) return json({ call: null });

  const ageMs = Date.now() - new Date(row.created_at.replace(" ", "T") + "Z").getTime();
  if (ageMs > RING_WINDOW_MS) return json({ call: null });

  return json({ call: row });
}
