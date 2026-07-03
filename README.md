# CITY_NET

A real-time 3D city map for tabletop RPG sessions. The GM builds and manages the city; players connect and explore it live. Built with React + Three.js on the front, Node.js + SQLite on the back, and Socket.IO stitching it all together.

---

## For Game Masters — Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) v18 or newer
- A terminal (PowerShell, bash, etc.)

### 1. Clone the repo

```bash
git clone https://github.com/over2take/CITY_NET.git
cd CITY_NET
```

### 2. Configure the backend

```bash
cd backend
cp .env.example .env
```

Open `backend/.env` and set your values:

```env
ADMIN_USER=your_admin_name
ADMIN_PASS=your_secure_password
JWT_SECRET=some_long_random_string

PORT=5000

# Optional — require players to register accounts before joining
SECURE_MODE=false
```

> **Never commit `.env`.** It's already in `.gitignore`.

### 3. Install dependencies

```bash
# From the repo root
cd backend && npm install
cd ../frontend && npm install
```

### 4. Run in development

Open two terminals:

```bash
# Terminal 1 — backend
cd backend
node server.js

# Terminal 2 — frontend
cd frontend
npm run dev
```

Frontend is at `http://localhost:5173`, backend at `http://localhost:5000`.

### 5. Build for production

```bash
cd frontend
npm run build
```

Then start the backend — it serves the built frontend automatically:

```bash
cd backend
node server.js
```

Everything runs on port `5000`. To expose it publicly you need a reverse proxy or tunnel pointing at `localhost:5000`. Three common options:

> **Note:** if you're running the [Docker stack](#6-docker-optional) instead of this manual setup, the app is served by Nginx on port `80`, not `5000` — point your tunnel at `localhost:80` instead. The backend container isn't reachable directly from the host.

**Cloudflare Tunnel** (recommended — free, no port forwarding, works behind NAT)
1. Install [cloudflared](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/)
2. `cloudflared tunnel --url http://localhost:5000` (or `:80` for Docker)
3. Cloudflare prints a public `https://` URL — share that with your players

**ngrok** (quick and easy, free tier has session limits)
1. Sign up at [ngrok.com](https://ngrok.com) and install the CLI
2. `ngrok http 5000` (or `80` for Docker)
3. ngrok prints a public URL good for the session

**Nginx** (self-hosted, requires a domain and a VPS/home server with open ports)
- An `nginx.conf` is included in the repo — it proxies HTTP and WebSocket traffic to port `5000`
- Point your domain's DNS at your server, install [Nginx](https://nginx.org/en/docs/install.html), drop the config in `/etc/nginx/sites-available/`, and enable it
- Pair with [Certbot](https://certbot.eff.org/) for free HTTPS via Let's Encrypt

### 6. Docker (optional)

A `docker-compose.yml` is included. Copy `.env.example` to `backend/.env`, fill it in, then:

```bash
docker compose up -d
```

The compose file includes [Watchtower](https://containrrr.dev/watchtower/) — it watches your containers and automatically pulls updated images when you push a new build to Docker Hub.

---

## Secure Mode

When `SECURE_MODE=false` (default), players just enter a name to join — no password required.

When `SECURE_MODE=true`, players must register an account before they can access the map. Registration is self-service from the login screen.

**Admin first login with Secure Mode ON:**
Enter your `.env` admin credentials on the player login screen. The app will recognise them as admin credentials, log you in, and open the admin dashboard automatically — no separate player account needed.

---

## Admin Panel

Click `ADMIN_LOGIN` in the top bar once you're on the map. Enter your `.env` `ADMIN_USER` / `ADMIN_PASS`. This gives you access to:

- Full map editing (create, move, edit, delete locations)
- Player token management (place and move player characters)
- HP / injury tracking for all players
- Bank ledger and scheduled pay
- Dice roll history
- Battle map uploads
- City database and district management

---

## Project Structure

```
CITY_NET/
├── backend/
│   ├── server.js               # Express entrypoint — mounts routes, starts Socket.IO
│   ├── db.js                   # SQLite schema and migrations
│   ├── middleware/
│   │   └── auth.js             # JWT verify middleware (admin + elevated users)
│   ├── routes/
│   │   ├── admin.js            # Admin-only REST endpoints
│   │   ├── locations.js        # Location CRUD
│   │   ├── battle_maps.js      # Battle map image upload/management
│   │   ├── maps.js             # Saved map snapshots
│   │   ├── roads.js            # Road CRUD
│   │   └── player.js           # Player auth (register, login, forgot, reset)
│   ├── sockets/
│   │   └── index.js            # All Socket.IO event handlers
│   └── startup/
│       └── sanity_checks.js    # In-memory DB checks on boot
│
├── frontend/
│   ├── src/
│   │   ├── App.tsx             # Root component — state, routing, socket wiring
│   │   ├── App.css / index.css # Global styles and CSS variables
│   │   ├── components/
│   │   │   ├── AdminPanel.tsx          # GM dashboard
│   │   │   ├── HitPoints.tsx           # HP tracking + injury panel + HealthReviewWindow
│   │   │   ├── BankWindows.tsx         # Player bank UI
│   │   │   ├── ChatWindow.tsx          # In-game chat
│   │   │   ├── DiceTray.tsx            # Dice roller
│   │   │   ├── Buildings.tsx           # 3D building meshes
│   │   │   ├── Rhombuses.tsx           # Player token meshes
│   │   │   ├── MapElements.tsx         # Roads, water, overlays
│   │   │   ├── Sidebar.tsx             # Nav rail — controls, volume, help, geometry tools
│   │   │   ├── SecureLogin.tsx         # Player login, registration, and password reset UI
│   │   │   ├── CityDatabase.tsx        # Location search/browse
│   │   │   ├── DraggableWindow.tsx     # Reusable draggable panel wrapper
│   │   │   ├── AttackAnimations.tsx    # Attack hit/miss animations (swipe, projectile, miss text)
│   │   │   ├── Streamer.tsx            # Camera broadcaster/rig pairs for streamer mode
│   │   │   ├── StreamerOverlay.tsx     # HUD overlay rendered on the spectator window
│   │   │   ├── StreamerDirectorPanel.tsx # Admin director controls (camera mode, visibility flags)
│   │   │   └── ...
│   │   ├── context/
│   │   │   └── StreamerVisibilityContext.ts # React context for audience-layer visibility flags
│   │   ├── hooks/
│   │   │   ├── useSocket.ts    # Socket.IO connection and all event listeners
│   │   │   ├── useApi.ts       # Fetch helpers
│   │   │   └── useMapData.ts   # Location/district/road data fetching
│   │   ├── streamerMode.ts     # IS_SPECTATOR constant — detects ?streamer=true URL param
│   │   └── utils/
│   │       ├── locationHelpers.ts  # Location geometry utilities
│   │       ├── rhombusHelpers.ts   # Player token position math
│   │       └── threeHelpers.tsx    # Three.js scene utilities
│   └── public/                 # Static assets (audio, icons)
│
├── docs/                       # Reference docs (deployment plans, feature notes)
├── Dockerfile.backend
├── Dockerfile.frontend
├── docker-compose.yml
├── nginx.conf
└── .env.example
```

### Tech stack

| Layer | Tech |
|---|---|
| Frontend | React 19, TypeScript, Three.js, @react-three/fiber, Vite |
| Backend | Node.js, Express 5, SQLite3 |
| Realtime | Socket.IO |
| Auth | JWT (admin) + bcrypt (player accounts) |
| Deployment | Docker, Nginx, Watchtower |

### Key architectural patterns

- **Socket.IO is the source of truth for live state.** REST endpoints handle persistence; sockets broadcast `dataUpdated` events so all clients re-fetch.
- **`useSocket.ts` owns all socket subscriptions.** Adding a new real-time event means adding it there and nowhere else.
- **`DraggableWindow` is the UI primitive.** Every floating panel wraps it.
- **Inline SVG components instead of `<img>` tags** for icons that need CSS-variable colour control.
- **Secure Mode is a pure opt-in.** When `SECURE_MODE=false`, the player auth routes return 404 and the frontend shows the simple name-only login — existing behaviour is unchanged.
- **Streamer mode is a read-only spectator client.** Append `?streamer=true` to the URL to open a broadcast-safe overlay view. The spectator socket role is invisible to presence/chat and all mutating events are blocked server-side. A `DirectorState` object is broadcast from admin to spectators over Socket.IO, controlling camera mode, visibility flags, scene title, and letterbox.

---

## Contributing

1. Fork the repo and create a branch off `main`
2. `npm run dev` (frontend) + `node server.js` (backend) for local development
3. Run tests: `cd frontend && npm test`
4. Open a PR against `main` — describe what changed and why

---

## License

[GNU Affero General Public License v3.0](LICENSE)

You are free to use, modify, and self-host this software. If you distribute a modified version — or run it as a hosted service — you must release your changes under the same AGPL-3.0 license and provide users access to the source code.
