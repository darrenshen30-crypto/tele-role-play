// functions/api/clubs.js — список локаций и создание новой.
// Доступ только тем Telegram id, что перечислены в OWNER_ID (через запятую) -
// приглашений нет, оба человека сразу видят все локации.

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

  // "Последнее сообщение" читается из кэш-колонок на самой clubs (см.
  // messages.js/dice.js/call.js/transfer.js - каждая пишет туда при отправке),
  // а не пересчитывается тут через MAX(id) по club_messages: тот способ
  // пересматривал всю историю комнаты при каждом опросе (список локаций
  // опрашивается раз в несколько секунд) и в проде упёрся в дневной лимит
  // чтения D1 - чем длиннее становилась история, тем дороже был каждый опрос.
  const { results } = await env.DB.prepare(
    "SELECT c.id, c.name, c.category, c.background_file_id, c.background_updated_at, c.music_url, c.owner_id, " +
      "c.last_message_id AS last_message_id, c.last_message_user_id AS last_message_user_id, " +
      "c.last_message_text AS last_message_text, c.last_message_character AS last_message_character, " +
      "COALESCE(r.last_read_message_id, 0) AS last_read_message_id " +
      "FROM clubs c " +
      "LEFT JOIN club_reads r ON r.club_id = c.id AND r.user_id = ? " +
      "ORDER BY c.category, c.name"
  ).bind(String(userId)).all();

  // Кто сейчас "отмечен" в локациях (см. club-checkin.js) - отдельным
  // запросом, а не JOIN'ом к clubs, потому что в одной локации может быть
  // отмечено сразу несколько персонажей (JOIN размножил бы строки клубов).
  // Таблица club_checkins всегда маленькая (не больше персонажей в проекте),
  // так что это дёшево даже при частом опросе списка локаций.
  const checkinRows = await env.DB.prepare(
    "SELECT cc.club_id, ch.name AS character_name FROM club_checkins cc " +
      "JOIN characters ch ON ch.id = cc.character_id " +
      "WHERE cc.checked_in_at > datetime('now', '-24 hours')"
  ).all();
  const checkinsByClub = {};
  (checkinRows.results || []).forEach(function (row) {
    (checkinsByClub[row.club_id] = checkinsByClub[row.club_id] || []).push(row.character_name);
  });

  const clubs = (results || []).map(function (row) {
    const unread = !!row.last_message_id &&
      String(row.last_message_user_id) !== String(userId) &&
      row.last_message_id > row.last_read_message_id;
    return {
      id: row.id, name: row.name, category: row.category,
      background_file_id: row.background_file_id, background_updated_at: row.background_updated_at,
      music_url: row.music_url, owner_id: row.owner_id, unread: unread,
      last_message_text: row.last_message_text || null,
      last_message_character: row.last_message_character || null,
      checked_in_characters: checkinsByClub[row.id] || [],
    };
  });

  return json({ clubs: clubs });
}

export async function onRequestPost(context) {
  const env = context.env;
  const userId = context.data && context.data.tgUserId;
  if (!isOwner(env, userId)) return json({ error: "Нет доступа." }, 403);

  const body = await context.request.json();
  const category = (body.category || "").trim();
  const name = (body.name || "").trim();
  if (!category) return json({ error: "Введите категорию." }, 400);
  if (!name) return json({ error: "Введите название." }, 400);

  let club = null;
  try {
    club = await env.DB.prepare(
      "INSERT INTO clubs (name, category, owner_id) VALUES (?, ?, ?) " +
        "RETURNING id, name, category, background_file_id, background_updated_at, music_url, owner_id"
    ).bind(name, category, String(userId)).first();
  } catch (e) {
    console.log("Ошибка создания локации:", e.message);
    return json({ error: "Не удалось создать локацию." }, 500);
  }

  return json({ club: Object.assign({ unread: false }, club) });
}
