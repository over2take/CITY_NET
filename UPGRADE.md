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

### Running without the Docker socket

The in-app update works by talking to the Docker socket, which is mounted into the backend
container. **That socket is root on the host.** Anything that can reach it can start a
privileged container and mount your whole filesystem — so the security boundary of an
install is: anyone who can reach the update endpoint, or achieve code execution in the
backend, has root on the machine.

For an install exposed to the internet, **removing that mount is a reasonable choice, and
a supported one.** Delete this line from the `backend` service in `docker-compose.yml`:

```
      - /var/run/docker.sock:/var/run/docker.sock
```

Everything else keeps working — nothing touches Docker at startup, and every Docker call
lives inside a request handler. The only thing you lose is the update button, which will
refuse with an explanation rather than failing strangely. Update from the host instead:

```bash
docker compose pull
docker compose up -d
```

One side effect worth knowing: `GET /api/version` reports `isDocker: false` without the
socket, so a socket-less install presents as a non-Docker one.

### What you are trusting when you press Update

An update pulls `over2take/citynet-backend` and `over2take/citynet-frontend` from Docker
Hub and runs them as root with the host socket mounted. **Pressing Update therefore trusts
that Docker Hub account completely** — if it were compromised, the attacker's code would
run as root on every install that updated.

This is inherent to any auto-updater, and it is worth stating plainly rather than leaving
implicit. Images are currently pulled by tag, not by digest, so an update takes whatever
is published under that tag at the time you press the button.

If that trust is more than you want to extend:

- Remove the socket mount (above) and update from the host, where you can inspect what you
  are pulling first.
- Or pin `IMAGE_TAG` to a specific released version, so you move deliberately rather than
  automatically.

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

### [1.10.0]

No new or changed environment variables. **Docker installs need to do nothing** — a normal
`docker compose pull` is enough.

**Battle maps can now be up to 250MB**, for animated map loops. The bundled web server
config allows that already, and it travels inside the frontend image, so pulling both
containers carries it. Two things follow:

- **Pull the frontend image, not only the backend.** The size ceiling lives in the web
  server's config. A backend-only update leaves the proxy refusing anything over 25MB, and
  the upload fails with a bare 413 that names neither the file nor the reason.
- **If you run your own proxy in front of CITY_NET**, raise its body limit to match, or
  large maps are refused before they reach the app:

  ```
  client_max_body_size 250M;
  ```

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
