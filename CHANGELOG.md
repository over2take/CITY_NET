# Changelog

All notable changes to CITY_NET are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

---

## [Unreleased]

---

## [1.2.2] - 2026-07-06

### Fixed
- **In-app update** — backend now runs as root to access Docker socket; compose project name detected from container labels so correct containers are replaced

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
