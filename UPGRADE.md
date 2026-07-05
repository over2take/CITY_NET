# Upgrade Guide

When pulling a new version of CITY_NET from Docker Hub, follow the upgrade path for your version. Each section lists what changed and any manual steps required.

---

## [1.1.7] - 2026-07-05

### New Environment Variables
- **`WATCHTOWER_API_TOKEN`** — Required. Enables the manual "Check for update" button in the admin panel. Generate a strong random token.
- **`APP_PORT`** — Optional. Controls which port the app is exposed on (default `80`). Change to `8080` if your ISP blocks port 80.
- **`DUCKDNS_SUBDOMAINS`** — Optional. Your DuckDNS subdomain (e.g., `yourcity`). Only needed if using the `duckdns` service.
- **`DUCKDNS_TOKEN`** — Optional. Your DuckDNS token from https://www.duckdns.org. Only needed if using the `duckdns` service.
- **`TZ`** — Optional. Timezone for Watchtower schedule and DuckDNS container (e.g., `America/Chicago`).

### Upgrade Steps
1. Pull the latest images: `docker compose pull`
2. Copy the updated `.env.example` from the running container:
   ```bash
   docker cp citynet-backend:/app/.env.example ./backend/.env.example.new
   ```
3. Compare with your current `.env`:
   ```bash
   diff backend/.env.example backend/.env.example.new
   ```
4. Add the new variables to `backend/.env`:
   ```env
   WATCHTOWER_API_TOKEN=your-strong-random-token-here
   ```
5. Restart: `docker compose up -d`
6. On startup, the backend will warn you if any required vars are still missing.

### New Features
- Manual "Check for update" button in the CITY_NET system info panel (admin only)
- DuckDNS support for persistent dynamic DNS
- Configurable host port via `APP_PORT`
- IPv6 LAN direct connect support (no port forwarding needed for local play)
- Automatic env var validation on startup with helpful warnings
- CHANGELOG.md and upgrade guides

---

## [1.0.7] and earlier

For upgrades from 1.0.6 → 1.0.7, check the CHANGELOG.md for the feature list. No manual env var changes were required for that version.

For versions 1.0.0 — 1.0.6, manual setup was simpler and migration steps weren't tracked. Consult CHANGELOG.md for each version's features.
