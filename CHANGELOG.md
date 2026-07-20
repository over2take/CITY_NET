# Changelog

All notable changes to CITY_NET are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

---

## [Unreleased]

---

## [1.6.1] - 2026-07-19

SR6 polish: drain resistance, glitch feedback, Edge management, NPC sheet fixes, and name/description sync.

### Added

- **Drain resistance** — each spell row in the AWAKENED tab gains a yellow RES button (enabled when Drain Value and tradition attribute are set); clicking it rolls WIL + tradition attr, applies net drain to the Stun track, and overflows excess into Physical HP automatically
- **Glitch / Critical Glitch banner** — dice tray displays a pulsing yellow GLITCH or red CRITICAL GLITCH banner after any SR6 pool roll that qualifies; clears on the next roll
- **SR6 Edge management (admin)** — Admin Panel SR6 section adds REPLENISH ALL EDGE (resets every player's Edge to their max) and a per-player GIVE 1 EDGE button (online non-admin players only, capped at max)

### Fixed

- **NPC sheet system mismatch** — OPEN_SHEET now only shows when the linked sheet's system matches the active game system; a CWN sheet no longer surfaces under SR6 and vice versa
- **GENERATE_SHEET → OPEN_SHEET flip** — button switches immediately after generation without requiring the token window to be closed and reopened; `system` is now included in the `npcSheetGenerated` socket event
- **Edge pips not rendering** — pip display now uses the higher of current or max edge so pips appear even before `edge_max` has been explicitly saved
- **NPC sheet name/description sync** — editing name or description on an NPC sheet updates the linked map token label live (sheet → token); saving an enemy/friendly token with a changed name or description patches the linked sheet (token → sheet); generation already seeded both fields from the token

---

## [1.6.0] - 2026-07-18

Shadowrun 6E — third full game system, built entirely on the existing sheet/roll/attack architecture.

### Added

**Shadowrun 6E system**
- **SR6 character sheet** — 9 attributes (BOD–EDG), Essence/Magic/Resonance, 16 consolidated skills rolled as d6 pools, 4 weapon rows (DV / AR / mode / atk), Edge pips (spend-by-click, CP:R LUCK pattern), derived Physical/Stun monitors, initiative score and composure recomputed on every save
- **Pool dice engine** — new `pool` roll shape: pool size = attribute + skill (+mods), 5s and 6s are hits, glitch when half or more of the pool shows 1, critical glitch on a glitch with zero hits; results land in the dice tray as `N hits / M dice`
- **Two damage tracks** — Physical monitor lives on the token (HP bar as usual); Stun is a sheet track that clamps at the Stun Monitor and overflows the excess into Physical automatically, server-side
- **SR6 attacks** — one ATTACK button: attack pool, weapon Attack Rating compared to the target token's Armor Rating shifts DV ±1, damage applies to Physical with a "GM: soak BOD+ARMOR" prompt (soak stays manual per RAW-lite)
- **Auto-rolled defense** — defenders backed by a sheet dodge automatically (REA + INT pool, shown in the dice tray); net hits decide the hit and add to the DV; sheetless tokens don't defend
- **Stun bar in the health window** — SR6 health review shows the Stun track (cyan bar, red + overflow warning when full) under the Physical monitor, live-updating; served by a public two-number stun endpoint
- **AWAKENED / EMERGED tabs** — gated behind the new `sr6_awakened` and `sr6_emerged` house rules (spells/powers/tradition and complex forms/sprites)
- **SR6 NPC tiers** — Ganger / Street Tough / Shadowrunner / Prime Runner for GENERATE_SHEET, with consistent monitors, armor and weapon rows
- **SR6 sheet import** — attribute/skill aliases (BOD, AGI, cc, perc…), Edge max seeds current, plain-text stat block parser

### Changed

**Modularity pass**
- **Gated sheet tabs are data** — `GATED_TABS`/`hiddenTabsFor` config replaces per-system conditionals in the player sheet hook and the admin NPC window
- **One import mapper** — `makeMapFields` factory: CP:R / CWN / SR6 importers are now alias tables + numeric sets around a single shared loop
- **Shared attack scaffolding** — target lookup and `attackResult` emission extracted from the CWN and SR6 handlers; per-system attack code is rules only

---

## [1.5.1] - 2026-07-17

NPC portraits with a glitchy TV/CRT effect, stock headshot library, and token info window improvements.

### Added

**NPC portraits**
- **Stock headshot library** — 16 bundled NPC headshots (new art by **PaMuDA**) served from `frontend/public/npc-headshots/`; `GENERATE_SHEET` auto-assigns a random headshot to new NPC sheets
- **HEADSHOTS picker** — admin button on the NPC sheet window opens a `<  N/16  >` prev/next navigator to browse and assign any stock headshot; seeds to the current portrait when it's a stock image
- **`TvPortrait` component** — reusable, self-contained glitchy TV/CRT portrait effect (chromatic R/B fringe, scanlines, rolling refresh band, intermittent glitch jitter) usable on any portrait; `BracketPortrait` and the token info window both use it
- **FX toggle** — per-sheet `portrait_shadow_filter` field with an FX ■/□ button under the sheet portrait enables/disables the TV effect (on by default)
- **Public token identity route** — `GET /api/sheets/npcs/link-public/:location_id` returns sheet name + portrait only (no stats/description) for enemy and friendly tokens

### Changed

**Token info window**
- Title now reads `ID: {sheet name}` from the linked NPC sheet instead of `HOSTILE_NODE`
- Portrait from the linked sheet displays in the window with the TV effect
- `DATA_DESCRIPTION` pulls from the linked sheet's description (admin view); falls back to the data point's description
- All players (not just admin) now see a linked token's name and portrait; description and stats remain admin-only — the GM builds mystery manually by leaving a token unlinked or unnamed
- `EDIT_DATA_POINT` is hidden for tokens linked to a sheet — the sheet drives name/description
- `CHECK_HEALTH` now opens only the health window; the quick sheet card no longer auto-opens with it

---

## [1.5.0] - 2026-07-16

Cities Without Number (CWN) — second full game system, accessibility theme picker, and a major frontend deduplication pass.

### Added

**Cities Without Number system**
- **CWN character sheet** — 6 attributes with SWN modifier table (0/unset → neutral, not −2), 3 saving throws, 19 skills (2d6 plain sum), combat stats (BHB, AC as token-linked writable field), System Strain (current/max), conditions (Frail, auto-initiative), and a Deluxe tab (4 spell rows + summoning) gated behind the `cwn_deluxe` house rule
- **Armor section** — players enter BASE_AC + DEX_CAP + SHIELD_BONUS; `cwnEffectiveAc` computes and pushes the result to the token on every save; field stays hand-managed when armor is blank
- **CWN combat** — single ATTACK button (same UX as CP:R); 1d20 + BHB + skill + attr mod roll-to-hit vs target AC; damage roll + attr mod; trauma die checked against the defender's Trauma Target (default 6) — rating is the damage multiplier; shock damage on miss if target AC is low enough; all results land in the dice tray
- **Stabilize flow** — MORTALLY WOUNDED banner at 0 HP; clicking STABILIZE rolls the clicking user's 2d6 + Heal + INT mod vs DC 8 + rounds since downed (+ 2 without tools); on success: target becomes Frail and gains 1 HP after the dice animation completes; on failure: `rounds_since_downed` increments; allies see the STABILIZE button on the Health Review window (their Main Action per RAW)
- **FRAIL banner** — shown above 0 HP when the `frail` flag is set; CLEAR FRAIL button (GM-approved) clears it
- **STIM_HEAL** — field-healing shortcut adds +1 System Strain then heals; refuses with STRAIN MAXED (409) when at max
- **LONG REST** — admin panel button recovers 1 strain on every CWN sheet
- **Spell rows** — manual name/effect/damage/cost fields; per-row CAST button rolls damage if present, spends Effort, flags OVERCAST! if insufficient
- **CWN house rules** — `cwn_trauma` (default ON — gates trauma die and major-injury flow) and `cwn_deluxe` (default OFF — gates Deluxe tab); data-driven `HouseRulesPanel` component replaces both old bespoke IIFE blocks
- **CWN NPC tiers** — Warrior / Expert / Boss / Elite combat tiers + 3 Spirit tiers; each stamped with `trauma_target: 6`; NPC melee DV formula is system-specific (CP:R formula only for `cyberpunk_red`)
- **CWN sheet import** — alias mapping for all 19 skills, armor fields, spell rows, and `trauma_target`

**Accessibility — login theme picker**
- **Theme picker on login screen** — custom dropdown ("THEMES ∨") lets players change the UI theme before logging in; each option is styled in its own theme's primary colour
- Theme saved to `localStorage` immediately; written to `player_accounts.theme` on login
- Theme returned in the JWT payload and applied on every session without a re-login
- Logo scene glow, non-animated text, and version badge all follow the active theme
- Standalone sheet tab reads theme from the socket auth handshake (`currentTheme` prop) or `localStorage` fallback

### Changed

**Frontend deduplication**
- **`usePlayerSheet` hook** — extracted shared sheet state, debounced saves, house-rule fetches, and action emitters (roll / deathSave / stabilize / castSpell) from both `CharacterSheetWindow` and `SheetPage`; both surfaces now share one implementation and have full CWN feature parity
- **`SheetAttackPanel`** — unified component replaces the separate `CprAttackPanel` and `CwnAttackPanel`; driven by `ATTACK_PANEL_CONFIG` keyed by game system
- **`hasSheetCombat(system)`** — exported from `Sidebar.tsx`; all `gameSystem === 'cyberpunk_red' || gameSystem === 'cities_without_number'` checks in App and Sidebar replaced with a single capability predicate; adding ruleset N requires only one config entry
- **`HouseRulesPanel` component** — data-driven (accepts `HouseRuleDef[]`); CP:R and CWN house-rule panels are now one-liners

**Dice tray**
- Back-to-back broadcasts (e.g. to-hit + damage from a single attack) are now queued and played sequentially instead of overwriting each other; dice rolls play for 5 s, dice-less results (shock) for 0.8 s

### Fixed
- Unset stats (value 0) now map to modifier 0 under the SWN table — previously bucketed as ≤ 3 → −2
- AC on the character sheet now reads from and writes to the token's `melee_ac` / `ranged_ac` fields; unset token AC defaults to 10
- Health review window was resolving to the enemy's token when both the enemy and the player share the same owner; now prefers the `rhombus` shape
- Stabilize / death-save outcome (Frail flag, HP write, penalty) now applies after the dice animation completes (`DICE_ANIM_MS` delay), not before
- NPC tiers generated for non-CP:R systems no longer receive the CP:R melee-DV formula
- Trauma die now resolves against the defender's Trauma Target (default 6), not the weapon's rating; rating is the damage multiplier
- Version text on the login screen now uses the theme's `--green` colour with bold weight and glow

---

## [1.4.1] - 2026-07-14

### Fixed
- **App version fallback** — backend `/api/check-update` now reads the running version from `package.json` when the `APP_VERSION` env var is not set (manual installs and dev environments no longer show a false "update available" prompt)

---

## [1.4.0] - 2026-07-13

Cyberpunk RED character sheets: the full Phase 3-5 sheet system, making CP:R the first feature-complete game system.

### Added
- **Character sheet system** — template-driven sheets (one renderer, per-system templates); player window, admin view of any player/NPC sheet, standalone browser tab (`?sheet=true`), quick-sheet card, portrait upload with TV-glitch effect, segmented HP bar (green/yellow/red)
- **Server-authoritative rolls** — stat/skill rolls resolve against the stored sheet (exploding CP:R check die); results land in the dice tray and history
- **CP:R combat flow** — single ATTACK button; weapon picker from structured sheet weapon rows (name/DMG/skill/ROF); to-hit vs token DV; aimed shots (−8, head, ×2 damage through armor); damage auto-rolled, soaked by defender SP, armor ablation on penetration; damage writes through to token HP; attack animation follows the weapon type (melee/ranged)
- **SP SHIELD** — defender's shield intercepts damage first and breaks down point-for-point; overflow soaks against location SP
- **Critical injuries** — two+ max-face damage dice trigger +5 direct damage (ignores armor/shield) and prompt the GM to roll the book's injury table (table not embedded)
- **Death saves** — MORTALLY WOUNDED banner at 0 HP with DEATH SAVE button; 1d10 + escalating penalty vs BODY (natural 10 always fails); penalty resets on healing above 0
- **Seriously Wounded** — banner at ≤ threshold HP; −2 to all checks applied server-side (−4 while mortally wounded)
- **Armor penalty** — heavy-armor stat penalty applied to all REF/DEX-keyed checks and attacks
- **LUCK on rolls** — arm pips on the sheet (declared before the roll, per RAW) for a flat bonus on the next roll; spend is capped/decremented server-side; attack panel has its own LUCK selector
- **House rules panel** (ADMIN → TTRPG_SYSTEM, staged APPLY/REVERT) — `MELEE_DV TAKE-10` (10 + DEX + Evasion instead of 6 +) and `LUCK BONUS ALSO NEGATES NAT-1` (also unlocks a dedicated 1-LUCK fumble shield); rules apply live via settingsUpdated
- **LUCK pips + admin reset** — hexagonal pips on the sheet header; RESET_ALL_LUCK in the admin panel restores every player to max
- **Humanity → EMP** — editing Humanity recomputes current EMP (= Humanity ÷ 10) on every write path (template-declared derived fields)
- **NPC library** — create/delete NPC sheets, folders with MOVE control, ATTACH sheet to a token, OPEN full sheet editor; NPC sheets mirror their linked token's HP live
- **Leveled NPC generation** — GENERATE_SHEET takes a per-system tier (CP:R: MOOK/SKILLED/PRO/ELITE) seeding stats, skills, armor, weapons, token HP and DVs; melee DV computed from the sheet (6/10 + DEX + Evasion), GM can override via EDIT_DV
- **Sheet import** — IMPORT on every sheet window: fillable-PDF form extraction, JSON paste, or stat-block text; per-system alias mapping with preview before apply; linked fields (HP/cash) refused with explanation
- **Token defense per system** — MELEE_AC/RANGED_AC labels become MELEE_DV/RANGED_DV under CP:R; CP:R hides the two-button melee/ranged flow behind one ATTACK button
- **OPEN_SHEET on token windows** — players open their own sheet from their token; admins open any player's or NPC's sheet from any token
- **`npm run dev` (backend)** — nodemon auto-restart so backend code changes apply without manual restarts

### Changed
- **TTRPG_SYSTEM panel** moved above CURRENCY_ICON in the admin panel; SHEETS list removed
- **Sheet UX polish** — placeholders (ghost example text) on all free-form fields, upload hint bar attached under the portrait, weapon rows replace the free-text weapons area (notes field retained), CUR ≤ MAX clamping on paired fields (frontend + server)
- **CHECK_HEALTH window** — now resolves NPC tokens and tracks live HP by token id (was frozen at open and player-only)

### Fixed
- **NPC armor ignored in attacks** — defender sheet lookup branched on token owner instead of token type, so enemy tokens (which carry an owner) never found their linked NPC sheet; SP always read 0
- **DV edits not reflected** — EDIT_DV saved correctly but the token window showed the stale snapshot until reopen
- **Death save / FIRE appearing dead** — stale backend process; mitigated permanently by the new `npm run dev` watcher

### Tests
- 377 backend / 574 frontend — new suites: `cpr_attack` (to-hit, armor, shield, crits, LUCK, death saves), `sockets.deathsave` (socket integration: death saves, NPC SP, import apply, tiered generation, fumble-shield gating), `sheet_import` (PDF/JSON/text extraction + mapping), `npc_tiers`, plus renderer/library/import-dialog coverage

---

## [1.3.1] - 2026-07-08

### Added
- **Health in broadcast info card** — when the admin clicks a player/enemy/friendly token in broadcast mode, the spectator info card now shows the heart monitor (animated EKG, flatlines at 0 HP) and injury map (body silhouette with red zone overlays, BLIND/BLEEDING flags); injury map only appears when injuries are present
- **RETURN_TO_ORIGIN button** — added to the top of the Quick Access menu; smoothly flies the camera back to world center

### Fixed
- **Broadcast zoom direction** — spectator camera was zooming toward screen center instead of the admin's cursor; fixed by deriving `lookAt` from the camera's actual forward direction rather than the orbit pivot, which `dollyToCursor` does not update
- **Dice roll broadcast delay** — spectator overlay was showing roll results immediately; now waits the same 5-second animation delay as the roller's own DiceTray
- **AC hidden from non-admin players** — the attack banner in the DiceMenu and the rhombus info window no longer show AC value or roll threshold to non-admin players; admins still see full detail

---

## [1.3.0] - 2026-07-08

### Added
- **PLAYERS panel in admin dashboard** — primary admin can grant or revoke temporary admin access to online players directly from the admin panel; offline players are listed but cannot be granted access
- **Custom confirm modals** — replaced all browser `confirm()` dialogs (PURGE_ALL_WATER, PURGE_CHAT_HISTORY, PURGE_ROLL_HISTORY) with consistent in-app modals
- **CUSTOM_STRUCTURE dashboard** — renamed JOIN_STRUCTURE to CUSTOM_STRUCTURE with updated copy explaining prefab structure classification
- **Non-admin health view** — non-admin players see only the heartbeat monitor and injury map when reviewing a token's health; HP numbers are hidden

### Changed
- **UI label clarity pass** — ACCESS_CODE → PASSWORD (all forms), JOIN_STRUCTURE → CUSTOM_STRUCTURE, GEOMETRY_PROTOCOLS → TOKEN_PROTOCOLS, all rhombus/beacon labels updated to TOKEN_*, INITIALIZE_RHOMBUS → PLACE_MY_TOKEN, and many more across Sidebar, AdminPanel, BankWindows, and UpdateModal
- **CUSTOM_SIGNS button** — moved below all `+` placement buttons and prefixed with `+` for consistency
- **Admin panel section order** — SIDEWALKS/SIGNAGE/SIGN_DENSITY moved above CURRENCY_ICON; BANK_SOUNDS grouped with CURRENCY section
- **CURRENT_SELECTION panel** — repositioned above `+ ADD_NEW_STRUCTURE` with equal padding for better visibility

### Fixed
- **Stale `elevatedUsers` bug** — `revokeEditing` and `editingFinished` now remove the user from `elevatedUsers`; previously a grant→revoke→re-request cycle gave full admin instead of an edit window
- **Stale `pendingRequests` bug** — `editingApproved` and `editingDenied` now broadcast request removal to all clients; newly-promoted temp admins no longer inherit accumulated edit requests from earlier in the session

### Tests
- `backend/__tests__/sockets.editing.test.js` — 13 cases covering approveEditing, revokeEditing, editingFinished, grant/revoke elevated access, and regression scenarios
- `frontend/src/hooks/__tests__/useSocket.pendingRequests.test.ts` — 9 cases covering pendingRequests state transitions and the stale-request regression

---

## [1.2.4] - 2026-07-07

### Added
- **Animated 3D login logo** — `LogoScene` component renders a Three.js hex badge with wireframe skyline, spinning octahedron gem, and CITY_NET text label above the login panel
- **`LogoScene.tsx`** — standalone Three.js scene (no react-three-fiber) with auto-rotation, gem bob animation, and green glow drop-shadow matching the app's CSS variables

### Changed
- **Password field labels** — `ACCESS_CODE` / `CONFIRM_ACCESS_CODE` renamed to `PASSWORD` / `CONFIRM_PASSWORD` on login, register, and password reset screens for clarity

---

## [1.2.3] - 2026-07-07

### Added
- **Silent update notification modal** — admins see a draggable `SYSTEM_UPDATE` popup on login when a new version is available; supports UPDATE NOW, REMIND ME LATER (session), and SKIP VERSION (persistent)
- **Docker vs manual install detection** — update modal shows one-click update for Docker installs; manual install users are directed to install instructions instead
- **`GET /api/version` endpoint** — lightweight no-auth endpoint returning the running version; used for post-update polling without hitting Docker Hub

### Fixed
- **Post-update page reload** — frontend now polls `/api/version` after triggering an update and reloads only when the version changes, eliminating stuck "Update in progress" state
- **Nginx cache-busting** — `index.html` served with `Cache-Control: no-cache` so JS bundles always reload after an update
- **Helper container path resolution** — `docker compose` helper mounts `hostWorkingDir:/project` and uses `--project-directory /project`, fixing cross-OS path failures on Windows hosts
- **`WATCHTOWER_API_TOKEN` removed from required env vars** — no longer triggers missing env var warning banner on admin login

### Changed
- **Button hover/active states standardized** — global `button:hover` applies `filter: brightness(1.4)` across all buttons; colored variants (danger, enemy, friendly, deploy, map save/load) use CSS classes instead of inline style overrides
- Skip version and remind-later state is independent of the manual Check for Updates button in the nav panel — skipping the modal never blocks the sidebar update flow

---

## [1.2.2] - 2026-07-06

### Fixed
- **Update polling condition** — poll now compares running version against `originalCurrent` (captured before update), not against Docker Hub `latest`; fixes stale comparison when multiple versions exist on Docker Hub

---

## [1.2.1] - 2026-07-06

### Fixed
- **One-click in-app update** — admin panel now has a CLICK TO UPDATE button; no SSH required for future updates
- **APP_VERSION baked into Docker image** — version is now embedded at build time so all users see accurate version info regardless of their local docker-compose.yml

---

## [1.2.0] - 2026-07-06

### Fixed
- **APP_VERSION sync in release workflow** — Docker images now automatically deploy with APP_VERSION matching package.json version, eliminating false "update available" notifications

---

## [1.1.9] - 2026-07-06

### Added
- **Docker Hub version checking** — admin panel button queries Docker Hub for new versions
- **GitHub Actions auto-tagging** — release workflow now tags images with version numbers from package.json
- **PR template with checklists** — ensures version bumps and env var updates before merging

### Changed
- Watchtower removed in favor of manual Docker Hub pulling and GitHub Actions workflow
- README reorganized into Docker vs Manual setup paths with clear instructions
- Added Windows PowerShell command variants for cross-platform support

---

## [1.1.8] - 2026-07-05

### Added
- **UPGRADE.md** — comprehensive upgrade guide with step-by-step instructions for pulling new versions from Docker Hub
- **Env var status check** on admin login — admins get an in-app warning if critical environment variables are missing
- `GET /api/admin/env-status` endpoint — returns list of missing required env vars

### Fixed
- Backend startup now validates required env vars and logs helpful warnings if any are missing
- Removed stale root-level `.env.example` to eliminate confusion (canonical location is `backend/.env.example`)

---

## [1.1.7] - 2026-07-05

### Added
- Manual **Check for update** button in the CITY_NET system info panel (primary admin only) — triggers Watchtower on demand via its HTTP API
- **CHANGELOG.md** added to the repo
- Changelog link in the system info panel
- **DuckDNS** support — optional `duckdns` service in `docker-compose.yml` keeps your subdomain pointed at your current IP automatically
- **Configurable host port** via `APP_PORT` env var (default `80`) — change to `8080` or any port your ISP allows; players connect to `http://yourcity.duckdns.org:APP_PORT`
- **IPv6 LAN direct connect** documented — players on the same network can connect via `http://[ipv6-address]` with no port forwarding
- Let's Encrypt / Certbot HTTPS instructions added to README for DuckDNS setups
- `DUCKDNS_SUBDOMAINS`, `DUCKDNS_TOKEN`, `TZ`, and `APP_PORT` added to `.env.example`

### Fixed
- Build failure in Docker (`tsc -b` exit code 2) — `viewSettingsUpdated` socket type was missing `renderSidewalks`

---

## [1.0.7] - 2026-07-05

### Fixed
- Custom sign position now saves correctly after using the Move gizmo — replaced unreliable `dragging-changed` event detection with an explicit **UPDATE SIGN POSITION** button
- SAVE CHANGES on a sign now reads the mesh's actual position (not stale form values) so moving then saving no longer reverts on reload
- Signs are now scoped to saved maps — they save with the map and restore/clear on load/clear
- Signs no longer travel between maps on load
- Custom signs and auto-generated building signage now render in front of traffic (renderOrder fix)
- Cleared `signMesh` and `selectedSignId` on logout to prevent stale TransformControls state
- Removed X/Y/Z coordinate fields from the custom signs panel — position is managed via the Move gizmo

### Changed
- Sign transform controls now activate explicitly via MOVE / ROTATE buttons rather than auto-attaching on selection
- Added `signs_data` column to `saved_maps` table

---

## [1.0.6] - 2026-06

### Added
- Custom signs: CRT/TV shader filter with per-sign intensity control
- Custom signs: preset sign images and image URL rendering
- Custom signs: multi-line support with per-line font size
- Custom signs: free 3D transform gizmo — move and rotate selected sign in scene
- Custom signs: camera-center placement and real-time rotation slider
- Custom signs: font selector and remote font uploader
- Auto-signage on buildings with neon, billboard, and poster variants
- Sidewalk pavement rings around structures
- Road sidewalks toggle
- View settings (sidewalks, signage) broadcast to all connected clients

### Fixed
- Sign transform mode prop wiring
- Font upload now surfaces actual server errors
- Jitter sign positions along building face with overlap check

---

## [1.0.5] - 2026-05

### Added
- Watchtower automatic update checks at 4 AM daily
- Manual Docker Hub release workflow with image tags
- NAV_OS version driven from `package.json` via Vite define
- GitHub Actions CI pipeline

### Fixed
- Watchtower Docker socket path for Windows hosts (`//var/run/docker.sock`)
- Watchtower schedule corrected from every-30s to 4 AM cron

---

## [1.0.4] - 2026-04

### Added
- Ghost traffic drives overpasses with head/tail-light styling
- Road eraser dashboard with segment, path, and purge-all tools (purge-roads)
- Overpass split start/end ramp length controls
- WASD/arrow key camera pan while drawing roads or overpasses
- Continuous mitered ribbon road geometry with undo
- Ko-fi widget in sidebar

### Fixed
- Overpass-to-overpass connectivity, snap joins, and undo support
- Overpass ramp length persistence (`ramp_length_start`/`ramp_length_end`)
- Traffic car rendering above road surface; ramp length max 160
- Road segment chaining into full streets for smooth traffic fade
- Camera pan speed and WASD direction lerping
- `rampLength=0` holds full height at both ends

---

## [1.0.3] - 2026-03

### Added
- CRT scanline effects and per-theme gradients
- Themes palette with 7 themes wired to canvas, grid, buildings, and dice tray
- Water body persistence with map save/load/clear
- Overpass persistence with map save/load/clear
- Frontend hook extraction: `useMapData`, `useSocket`, `useApi`
- 52 frontend tests (threeHelpers, useApi, themes); 35 music tests; 28 battle map tests

### Fixed
- Theme colors applied to 3D components
- Camera dolly action for scroll-wheel zoom
- Overpass renderer preview and geometry core

---

## [1.0.2] - 2026-02

### Added
- Radio feed with volume mixer (separate BG and MUSIC sliders)
- Attack animations — Phase 1–5: AC fields, attack UI, socket wiring, hit/miss animations
- ARMOR_CLASS fields in GEOMETRY_PROTOCOLS menu
- Streamer mode: director panel, broadcast overlay, spectator socket role, camera sync
- Ping system with shadow outlines and Q-key shortcut
- Measurement tool with real-time drawing and `isFinal` relay
- Player name tags with hover/selection visibility and occlusion
- Secure Mode: player account auth with admin-approval registration flow
- Admin-approved password reset flow
- NPC impersonation in global chat
- Chat V2: context menus, PM tabs, NPC puppeting
- Admin temporary delegation via global chat
- `CHECK_HEALTH` button on player rhombus info window
- High roller notification persisted to DB (fires once only)

### Fixed
- Radio feed: master mute, stale socket closure, double-click to load track
- Attack: ARMOR_CLASS label rename, AC hidden from non-owners
- Streamer: battle map camera sync, zoom broadcast, active user roster on join
- Bank animations suppressed when closed; sounds suppressed over login chime
- HP clamp when max is lowered below current
- Socket reconnect with `playerToken` in Secure Mode
- Player info window status for online players with no beacon

---

## [1.0.1] - 2025-12

### Added
- CITY_NET // BANK and admin banking dashboards
- Player rhombus path animation and battle map dedup
- Injury tracking panel with body hit zones (major injuries)
- Health review window for other players (read-only)
- Battle map image upload (25 MB limit)
- Battle map active indicator (pulsating cross-swords)
- Friendly NPC rhombuses
- Custom structure cross-map library (`JOIN_STRUCTS`)
- District management UI and backend
- Admin approval workflow for temporary editing access
- Map Manager restricted to primary admin
- Custom cinematic modals replacing all `window.confirm`/`window.alert` calls

### Fixed
- Battle map floor sync, camera orientation, rhombus scaling
- Rhombus fade animation race condition
- Bank `-0.00` display and icon coloring
- Map load preserving `map_scale_multiplier`
- Structure deletion cleaning up associated battle maps and uploads
- NPC race condition on startup

---

## [1.0.0] - 2025-11

### Added
- Initial Docker containerized deployment (backend + frontend + Watchtower)
- Procedural city generation with themed building layouts (Corpo, Urban, Industrial, Slums)
- Interactive Draw a City mode
- Road network with instanced geometry and spatial grid
- Admin and player role system with JWT auth
- Saved maps (save / load / clear)
- Dice tray with physics
- Battle map system with floor support
- Player rhombuses with drag, overlap X-ray, and health tracking
- Enemy and friendly rhombus deployment
- Global and private chat
- Measurement tool
- Tree placer tool
- Custom structure editor and premade structure picker
- Water bodies with procedural shader
- FPS counter
