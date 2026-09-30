// functions/api/room-sound.js — синхронный звук атмосферы ("чокнуться
// бокалами", стук в дверь и т.п., см. index.html: openSoundFxPicker). Не
// хранится как обычное сообщение в club_messages - это мгновенный эффект, а
// не часть переписки, поэтому просто счётчик+ключ прямо на clubs
// (last_sound_id/last_sound_key), который обычный опрос комнаты
// (GET /api/messages, каждые 4с) уже возвращает вместе с остальным - без
// отдельного нового поллинга.
//
// Требование "слышен только когда оба реально в комнате" проверяется здесь
// же: у собеседника должна быть свежая запись club_reads.last_polled_at для
// этой же локации (обновляется каждым его опросом /api/messages - см. тот
// файл). Если собеседника сейчас нет - отклоняем целиком, ничего не играет
// ни у кого, а не только "беззвучно" у адресата.

const PRESENCE_WINDOW_SQL = "-8 seconds";

const SOUND_KEYS = [
  "glass_clink", "lighter", "door_knock", "glasses_clink", "hookah",
  "doorbell", "pour_water", "champagne_pop", "beer_open",
];

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status: status, headers: { "Content-Type": "application/json" } });
}

function isOwner(env, id) {
  if (!env.OWNER_ID || !id) return false;
  const ids = String(env.OWNER_ID).split(",").map(function (s) { return s.trim(); }).filter(Boolean);
  return ids.indexOf(String(id)) !== -1;
}

function ownerIdList(env) {
  return env.OWNER_ID ? String(env.OWNER_ID).split(",").map(function (s) { return s.trim(); }).filter(Boolean) : [];
}

export async function onRequestPost(context) {
  const env = context.env;
  const userId = context.data && context.data.tgUserId;
  if (!isOwner(env, userId)) return json({ error: "Нет доступа." }, 403);

  const clubId = new URL(context.request.url).searchParams.get("club_id");
  if (!clubId) return json({ error: "Не указана локация." }, 400);

  const body = await context.request.json();
  const key = body.key;
  if (SOUND_KEYS.indexOf(key) === -1) return json({ error: "Неизвестный звук." }, 400);

  const owners = ownerIdList(env);
  const other = await env.DB.prepare(
    "SELECT 1 AS x FROM club_reads WHERE club_id = ? AND user_id != ? AND user_id IN (" +
      owners.map(function () { return "?"; }).join(",") + ") AND last_polled_at > datetime('now', ?) LIMIT 1"
  ).bind(clubId, String(userId), ...owners, PRESENCE_WINDOW_SQL).first();
  if (!other) return json({ error: "Собеседника сейчас нет в этой локации." }, 400);

  let row = null;
  try {
    row = await env.DB.prepare(
      "UPDATE clubs SET last_sound_id = last_sound_id + 1, last_sound_key = ?, last_sound_at = datetime('now') " +
        "WHERE id = ? RETURNING last_sound_id"
    ).bind(key, clubId).first();
  } catch (e) {
    console.log("Ошибка звука атмосферы:", e.message);
    return json({ error: "Не удалось проиграть звук." }, 500);
  }
  if (!row) return json({ error: "Локация не найдена." }, 404);

  return json({ sound_id: row.last_sound_id });
}
