# Upgrade Guide

How to update CITY_NET to the latest version.

---

## Docker (recommended)

### In-app update (1.2.3+)

Log in as admin, open the nav panel, and click **CLICK TO UPDATE (docker only)**. The app will pull the latest image, restart all containers, and reload automatically.

If it cannot update, it now says why rather than waiting — the commonest reason being a container started before `docker-compose.yml` mounted itself into the backend, which is to say a long-running one. Recreating the stack once with the manual steps below fixes that permanently. Details of any failure are appended to `backend/data/update.log`.

**The in-app update pulls images, not files.** `docker-compose.yml`, `nginx.conf` and the rest come from the repository, so a release that changes one of them needs a `git pull` as well. Everything keeps working without it; only the new capability is missing.

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

### [1.9.4]

No new or changed environment variables, and **Docker installs need to do nothing** — the
one repository file this release touches is `nginx.conf`, which is built into the frontend
image rather than mounted from disk, so a normal pull or the in-app update carries it.

**If you run behind your own reverse proxy** — a manual install, or Docker with something
in front of it — add these to the block that proxies `/api/`:

```
proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
proxy_set_header X-Forwarded-Proto $scheme;
```

Without them every request reaches the backend from the proxy's address, so the new
per-player limit on Companion character imports counts your whole table as one caller.
Ten imports between everybody rather than ten each — a nuisance on a busy session night,
not a failure, and nothing else depends on it.

**If the backend is exposed directly, with no proxy at all**, put one in front of it. The
app now trusts one forwarding hop, which is correct behind a proxy and means a client
talking to the backend directly can claim to be any address it likes. The shipped
`docker-compose.yml` never publishes the backend port, so this does not apply to a stock
install.

One behaviour change worth knowing after you update: if Docker Hub rate-limits your update
check, you will now see an error saying so. It previously reported **"You're up to date"**
in that situation, which was indistinguishable from there being no new release.

### [1.8.1]
- **`IMAGE_TAG`** — Optional, defaults to `latest`. Selects the release channel: `latest` for stable releases, `dev` for development builds, or a pinned version such as `1.8.1`.

  **Existing installs need to change nothing.** An absent `IMAGE_TAG` resolves to `latest`, which is the behaviour you already have.

  If you do set it, put it in the `.env` beside `docker-compose.yml` as well as `backend/.env` — compose interpolates it from the project file rather than from `env_file`, and the setup steps already cover this by copying one to the other. It also requires the `docker-compose.yml` from 1.8.1 or later, since that is where the tag became a variable; see the note above about the in-app update not updating repository files.

  Development builds are unreleased and may break. They are only ever offered when `IMAGE_TAG=dev`.

### [1.2.3]
No new required vars. `WATCHTOWER_API_TOKEN` is no longer required — you can remove it from your `.env` if present.

### [1.1.7]
- **`APP_PORT`** — Optional. Port the app is exposed on (default `80`). Change to `8080` if your ISP blocks 80.
- **`DUCKDNS_SUBDOMAINS`** — Optional. Your DuckDNS subdomain. Only needed if using the `duckdns` service.
- **`DUCKDNS_TOKEN`** — Optional. Your DuckDNS token from https://www.duckdns.org.
- **`TZ`** — Optional. Timezone for the DuckDNS container (e.g., `America/Chicago`).

### [1.0.7] and earlier
No env var changes were required for these versions. See CHANGELOG.md for feature details.
