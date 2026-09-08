# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

**LorePlay** — a private Telegram Mini App for two (occasionally a few) people to run
collaborative roleplay: shared "locations" (rooms) with live chat and synced YouTube music,
private character-to-character messaging ("SMS"), and private account-to-account messaging
("Приват", out-of-character). No public users, no sign-up flow beyond picking a pseudonym -
access is a hard-coded Telegram id allowlist.

Product branding is "LorePlay" (splash screen, logo, design tokens), but the `<title>` and
the `app_title` i18n string are still the old name "Клубы" ("Clubs") - a known leftover, not
a bug, from before the rebrand.

## Commands

- **No build, no bundler, no test suite, no linter.** The frontend is a single static
  `index.html` (~3200 lines: inline `<style>` + inline `<script>`, no framework). The backend
  is Cloudflare Pages Functions under `functions/api/*.js`.
- **Deploy = `git push`** — Cloudflare Pages auto-builds `main` (output dir is the repo root,
  per `wrangler.toml`). To deploy immediately without waiting on the git-linked build, run:
  `wrangler pages deploy . --project-name tele-role-play --branch main --commit-dirty=true`
- **Verify manually** — there are no automated tests. Check changes by opening the Mini App in
  Telegram (fully close/reopen it to bypass caching) or via
  `https://tele-role-play.pages.dev?v=N` (bump `N` to bust cache).
- **Database migrations are ad hoc, not files.** There is no migrations folder and no schema
  file - the schema lives only in the live D1 database and is changed by hand:
  `wrangler d1 execute tele-role-play --remote --command "ALTER TABLE ... "` (or `--file` for
  multi-statement changes). Always use `--remote`; omitting it hits a local dev DB that the
  deployed app never sees. Check current schema before changing it:
  `wrangler d1 execute tele-role-play --remote --command "SELECT sql FROM sqlite_master WHERE type='table' AND name='...';"`
- After editing the inline `<script>` in `index.html`, sanity-check it parses before deploying
  (there's no build step to catch syntax errors otherwise):
  `node -e "new Function(require('fs').readFileSync('index.html','utf8').match(/<script>([\s\S]*?)<\/script>/)[1])"`

## Architecture

### Frontend (`index.html`, single file)

- **Screens, not routes.** Every screen is a `<div class="screen">`; `showScreen(name)` toggles
  `.active` via the `screens{}` name→id map and updates `currentScreenName`. There is no
  history/URL routing - Telegram's native hardware/gesture **BackButton** is wired manually
  through `updateTelegramBackButton()` (show/hide based on `currentScreenName`) and
  `handleTelegramBack()` (a switch statement mapping each screen to its "back" action) - when
  adding a screen, both must be updated or the platform back button will misbehave or exit the
  app instead of navigating back.
- **i18n**: `I18N = { ru: {...}, en: {...} }` plus `t(key)`, applied to markup via
  `data-i18n`/`data-i18n-ph`/`data-i18n-title` attributes and `applyStaticTranslations()`; some
  values are functions for pluralization (e.g. `sms_unread_count(n)`). Language persists in
  `localStorage`.
- **Theming**: CSS custom properties on `:root` (dark, default) and `html[data-theme="light"]`
  (light override) - note the *inverted* default from the usual convention. Design tokens are
  named `--lp-*`; older component CSS still refers to legacy names (`--bg`, `--ink`, `--panel`,
  `--amber`, ...) which are aliased to `--lp-*` values inside each theme block, not redefined
  independently - change the `--lp-*` source values, not the legacy aliases. Theme choice
  persists in `localStorage` and is applied before first paint.
- **`api(path, options)`** is the fetch wrapper used for all JSON calls - it injects
  `X-Tg-Init-Data: tg.initData` on every request; this header is what the backend verifies.
  File uploads (avatars, photos, location backgrounds) bypass this wrapper and call `fetch()`
  directly with the same header, since they send raw bytes, not JSON.
- **Chat/list "live" updates are polling, not WebSockets** - `setInterval` + a `poll*Messages()`
  function per surface (`pollMessages`, `pollSmsMessages`, `pollDmMessages`), cursor-based via
  `after_id`/`after_edit` query params so edits to older messages are also picked up.

### Backend (`functions/api/*.js`, Cloudflare Pages Functions)

- **One file per endpoint, and each file is fully self-contained.** `json()` and
  `isOwner(env, id)` are copy-pasted into nearly every function file rather than shared from a
  module - this is a deliberate project convention (no `_lib.js` exists), not an oversight.
  When adding an endpoint, copy the pattern from a similar existing file rather than trying to
  factor out a shared helper.
- **Auth model**: `functions/api/_middleware.js` runs on every request, verifies Telegram
  `initData`'s HMAC signature against `BOT_TOKEN`, and sets `context.data.tgUserId` /
  `context.data.tgUserName` for downstream functions. Authorization is a flat allowlist, not
  roles: `OWNER_ID` is a CSV of Telegram user ids in the Cloudflare env; `isOwner(env, id)`
  checks membership. There is no per-resource ownership model beyond that (e.g. any allowed
  user can currently edit any location's music/background - see `club.js`).
  `_middleware.js` also upserts `user_presence` (`last_seen`) on every request - this is the
  sole source of "online" status and of notification suppression (don't Telegram-notify
  someone who's actively in the app right now).
- **Photos are never stored by this app** - character avatars, profile avatars, and message
  photos are uploaded by relaying the bytes through the Telegram Bot API's `sendPhoto` (to the
  uploader's own chat) to obtain a `file_id`, which is the only thing persisted in D1.
  `functions/api/tg-photo.js` (and `club-bg-image.js` for backgrounds) fetch-and-proxy by
  `file_id` on demand. There is no Supabase/R2/S3 involved anywhere in this project.

### Data model (D1/SQLite, `DB` binding, database name `tele-role-play`)

Three parallel messaging surfaces, deliberately similar in shape:

- **Locations** ("клубы"): `clubs`, `club_messages` (+ `club_reads`, `club_attention_dismissed`,
  `club_photo_reveals`) - a shared room chat where each Telegram user speaks through one of
  their own `characters`. `club_playback`/`club_playback_ready` coordinate a synced "everyone
  presses play together" YouTube music state per location. `club_members` exists in the schema
  but is dead - a leftover from an older access model; current access control is purely
  `OWNER_ID`, not membership rows.
- **SMS** (`sms_threads`, `sms_messages`, `sms_reads`) - private **character-to-character**
  messaging, in-character. One thread per unordered pair of character ids
  (`char_low_id < char_high_id`, looked up/created both ways). Supports message edit and
  reply-to-message (`sms_messages.reply_to_id`, self-referencing).
- **Приват / DM** (`dm_threads`, `dm_messages`, `dm_reads`) - private
  **account-to-account** messaging, out-of-character (not through characters at all). Same
  shape as SMS but keyed by Telegram user id pairs (`user_low_id`/`user_high_id`) instead of
  character ids.

`characters` rows belong to a Telegram user via `owner_id`. `user_presence` holds both real
Telegram identity (`name`, `photo_url`, from `initData`, refreshed every request) and the
user's chosen `display_name`/`avatar_file_id` (set once via `functions/api/profile.js`) - the
pseudonym/avatar are what's actually shown anywhere another user can see them (e.g.
`users-list.js`), the real Telegram name/photo are a fallback only for a not-yet-registered
user. `index.html`'s `init()` gates the whole app on this: if `display_name` is unset, a
blocking registration screen is shown before anything else is reachable.

Each of the three messaging surfaces' "new message" endpoint notifies the other party via
Telegram `sendMessage` only if they're not currently online and haven't already read (or been
notified about) that message - see `notifyRecipient`/`notifyRecipients` in `messages.js` /
`sms-messages.js` / `dm-messages.js`.
