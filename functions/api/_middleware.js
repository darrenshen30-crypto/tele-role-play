// functions/api/_middleware.js — проверяет подпись Telegram initData (тот же
// приём, что и в plant-miniapp/recipe-notebook), чтобы остальные функции могли
// доверять, кто именно стучится, и никто не мог бы подделать чужой Telegram id.

async function hmacSha256(keyBytes, msgBytes) {
  const key = await crypto.subtle.importKey("raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, msgBytes);
  return new Uint8Array(sig);
}

function toHex(bytes) {
  return Array.from(bytes).map(function (b) { return b.toString(16).padStart(2, "0"); }).join("");
}

async function verifyInitData(initData, botToken) {
  if (!initData || !botToken) return null;
  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash) return null;
  params.delete("hash");

  const pairs = [];
  for (const [k, v] of params.entries()) pairs.push(k + "=" + v);
  pairs.sort();
  const dataCheckString = pairs.join("\n");

  const enc = new TextEncoder();
  const secretKey = await hmacSha256(enc.encode("WebAppData"), enc.encode(botToken));
  const computedHash = toHex(await hmacSha256(secretKey, enc.encode(dataCheckString)));
  if (computedHash !== hash) return null;

  let user = null;
  try {
    user = JSON.parse(params.get("user") || "null");
  } catch (e) {}
  return {
    userId: user && user.id,
    userName: user && (user.first_name || user.username),
    startParam: params.get("start_param") || null,
  };
}

export async function onRequest(context) {
  const initData = context.request.headers.get("X-Tg-Init-Data") || "";
  const verified = await verifyInitData(initData, context.env.BOT_TOKEN);
  context.data = context.data || {};
  context.data.tgUserId = verified ? verified.userId : null;
  context.data.tgUserName = verified ? verified.userName : null;
  return context.next();
}
