# Upgrade Guide

How to update CITY_NET to the latest version.

---

## Docker (recommended)

### In-app update (1.2.3+)

Log in as admin, open the nav panel, and click **CLICK TO UPDATE (docker only)**. The app will pull the latest image, restart all containers, and reload automatically.

### Manual Docker update

```bash
docker compose pull
docker compose up -d
```

The app will be back online in ~30 seconds.

### After updating

On startup the backend checks for missing required env vars and logs a warning if any are absent. If you see a warning banner on login, compare your `backend/.env` against `backend/.env.example` and add any missing keys.

---

## Manual install (non-Docker)

```bash
git pull origin main
cd frontend && npm install && npm run build
cd ../backend && npm install
```

Then restart your backend process. If you use PM2:

```bash
pm2 restart citynet-backend
```

---

## Environment variable changes by version

### [1.2.3]
No new required vars. `WATCHTOWER_API_TOKEN` is no longer required — you can remove it from your `.env` if present.

### [1.1.7]
- **`APP_PORT`** — Optional. Port the app is exposed on (default `80`). Change to `8080` if your ISP blocks 80.
- **`DUCKDNS_SUBDOMAINS`** — Optional. Your DuckDNS subdomain. Only needed if using the `duckdns` service.
- **`DUCKDNS_TOKEN`** — Optional. Your DuckDNS token from https://www.duckdns.org.
- **`TZ`** — Optional. Timezone for the DuckDNS container (e.g., `America/Chicago`).

### [1.0.7] and earlier
No env var changes were required for these versions. See CHANGELOG.md for feature details.
