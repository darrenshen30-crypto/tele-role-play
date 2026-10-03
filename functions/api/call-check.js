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

  // call_to_owner_id - денормализованный owner_id адресата, записанный прямо
  // при звонке (см. call.js), вместо JOIN на characters по call_to_character_id.
  // Без него и без индекса этот запрос (на каждом тике ВСЕГДА включённого
  // глобального опроса, с любого экрана, см. index.html: pollGlobalCallCheck)
  // читал практически всю club_messages на каждый вызов - именно это
  // исчерпало дневной лимит чтения D1 2026-10-03/04 (1500+ строк за один
  // такий опрос при полутора тысячах сообщений в комнатах). С частичным
  // индексом на call_to_owner_id (только у звонков, не NULL) запрос трогает
  // лишь сами звонки, а не всю историю переписки.
  const row = await env.DB.prepare(
    "SELECT id, club_id, user_name, character_name, character_avatar_file_id, created_at " +
      "FROM club_messages WHERE call_to_owner_id = ? AND call_response IS NULL " +
      "ORDER BY id DESC LIMIT 1"
  ).bind(String(userId)).first();

  if (!row) return json({ call: null });

  const ageMs = Date.now() - new Date(row.created_at.replace(" ", "T") + "Z").getTime();
  if (ageMs > RING_WINDOW_MS) return json({ call: null });

  return json({ call: row });
}
