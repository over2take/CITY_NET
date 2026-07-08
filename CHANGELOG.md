# Changelog

All notable changes to CITY_NET are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

---

## [Unreleased]

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
