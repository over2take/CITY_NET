#!/usr/bin/env bash
# ============================================================================
#  City_Net - Guided Setup
#  Generates your .env configuration and (optionally) launches the app.
#  Run from the project root:  bash setup.sh
# ============================================================================

set -euo pipefail

green() { printf '\033[0;32m%s\033[0m\n' "$1"; }
yellow() { printf '\033[0;33m%s\033[0m\n' "$1"; }
red() { printf '\033[0;31m%s\033[0m\n' "$1"; }
gray() { printf '\033[0;90m%s\033[0m\n' "$1"; }

read_default() { # prompt, default
  local answer
  read -r -p "$1 [$2]: " answer
  echo "${answer:-$2}"
}

read_required() { # prompt
  local answer
  while true; do
    read -r -p "$1: " answer
    [ -n "$answer" ] && { echo "$answer"; return; }
    yellow "  This field is required." >&2
  done
}

read_password() { # prompt
  local answer
  while true; do
    read -rs -p "$1 (input hidden): " answer
    echo "" >&2
    [ -n "$answer" ] && { echo "$answer"; return; }
    yellow "  This field is required." >&2
  done
}

read_yesno() { # prompt, default (y/n)
  local answer hint="y/N"
  [ "$2" = "y" ] && hint="Y/n"
  read -r -p "$1 [$hint]: " answer
  answer="${answer:-$2}"
  [[ "$answer" =~ ^[Yy]([Ee][Ss])?$ ]]
}

# --- Preflight --------------------------------------------------------------

echo ""
green "  ============================================"
green "        CITY_NET  //  GUIDED SETUP"
green "  ============================================"
echo ""

if [ ! -f "./docker-compose.yml" ]; then
  red "  ERROR: run this from the City_Net project root (docker-compose.yml not found)."
  exit 1
fi

# --- Install mode: Docker (recommended) or Manual (Node.js) ------------------

has_docker="n"
command -v docker >/dev/null 2>&1 && has_docker="y"

has_node="n"
if command -v node >/dev/null 2>&1; then
  node_major=$(node -v 2>/dev/null | sed 's/^v//' | cut -d. -f1)
  [ "${node_major:-0}" -ge 18 ] 2>/dev/null && has_node="y"
fi

mode=""
if [ "$has_docker" = "y" ] && [ "$has_node" = "y" ]; then
  gray "  Two install options are available:"
  gray "   - Docker (recommended): runs in containers, auto-restarts, includes DuckDNS"
  gray "   - Manual: runs directly with Node.js in a terminal"
  echo ""
  if read_yesno "  Use Docker? (recommended)" "y"; then mode="docker"; else mode="manual"; fi
elif [ "$has_docker" = "y" ]; then
  mode="docker"
elif [ "$has_node" = "y" ]; then
  yellow "  Docker was not found, but Node.js $(node -v) is installed."
  if read_yesno "  Continue with a manual (Node.js) install?" "y"; then
    mode="manual"
  else
    yellow "  Install Docker first: https://docs.docker.com/get-docker/"
    exit 1
  fi
else
  red "  Neither Docker nor Node.js (v18+) was found."
  yellow "  Install one of them first, then re-run this script:"
  yellow "   - Docker (recommended): https://docs.docker.com/get-docker/"
  yellow "   - Node.js v18+:         https://nodejs.org/"
  exit 1
fi
echo ""

if [ -f "./backend/.env" ]; then
  yellow "  A configuration already exists (backend/.env)."
  if ! read_yesno "  Overwrite it?" "n"; then
    green "  Setup cancelled - existing config kept."
    exit 0
  fi
  echo ""
fi

# --- Required settings ------------------------------------------------------

green "  --- Required settings ---"
echo ""

admin_user=$(read_default  "  Admin username" "admin")
admin_pass=$(read_password "  Admin password")

echo ""
if [ "$mode" = "docker" ]; then
  port_default="8080"
  gray "  App port: the port players connect on. 80 gives the cleanest URL,"
  gray "  but many home ISPs block inbound 80, so 8080 is the safe default."
else
  port_default="5000"
  gray "  App port: the port players connect on (the Node server listens here)."
fi

port_in_use() { # port -> 0 if something is already listening on it
  if command -v ss >/dev/null 2>&1; then
    ss -ltn 2>/dev/null | awk '{print $4}' | grep -qE "[:.]$1\$"
  elif command -v netstat >/dev/null 2>&1; then
    netstat -an 2>/dev/null | grep -i listen | awk '{print $4}' | grep -qE "[:.]$1\$"
  elif command -v lsof >/dev/null 2>&1; then
    lsof -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1
  else
    return 1  # no tool available - skip the check
  fi
}

# Warn if another program already owns the chosen port - localhost would then
# hit that app instead of City_Net on this machine.
while true; do
  app_port=$(read_default "  App port" "$port_default")
  # If it's our own running container holding the port, that's fine
  if [ "$mode" = "docker" ] && docker ps --format '{{.Ports}}' 2>/dev/null | grep -q ":$app_port->"; then
    break
  fi
  if port_in_use "$app_port"; then
    echo ""
    yellow "  WARNING: port $app_port is already in use by another program."
    yellow "  Connections on this port may reach that app instead of City_Net."
    if read_yesno "  Use port $app_port anyway?" "n"; then break; fi
    echo ""
  else
    break
  fi
done

echo ""
gray "  Secure Mode: if ON, players must register an account and be approved."
gray "  If OFF, players just type a name to join (simplest)."
if read_yesno "  Enable Secure Mode?" "n"; then secure_mode="true"; else secure_mode="false"; fi

# JWT secret - auto-generated, never prompted
jwt_secret=$(openssl rand -hex 32 2>/dev/null || head -c32 /dev/urandom | od -An -tx1 | tr -d ' \n')

# --- Optional settings ------------------------------------------------------

duck_sub="yourname"
duck_tok="your-duckdns-token"
tz="America/Chicago"
use_duck="n"

if [ "$mode" = "docker" ]; then
  echo ""
  green "  --- Optional: internet access via DuckDNS ---"
  gray "  DuckDNS gives you a free domain (e.g. yourcity.duckdns.org) so players"
  gray "  can connect over the internet. Skip this for LAN-only play."
  echo ""

  if read_yesno "  Set up DuckDNS now?" "n"; then
    use_duck="y"
    gray "  Get your subdomain and token at https://www.duckdns.org"
    duck_sub=$(read_required "  DuckDNS subdomain (the part before .duckdns.org)")
    duck_tok=$(read_required "  DuckDNS token")
    tz=$(read_default "  Timezone" "America/Chicago")
  fi
else
  echo ""
  yellow "  NOTE: the bundled DuckDNS service (automatic internet domain) requires"
  yellow "  Docker and is not available with a manual install. For internet play,"
  yellow "  see the 'Connectivity & Deployment' section of the README - Cloudflare"
  yellow "  Tunnel works well with a manual install and needs no port forwarding."
fi

# --- Write .env -------------------------------------------------------------

if [ "$mode" = "docker" ]; then
  env_content="JWT_SECRET=$jwt_secret
ADMIN_USER=$admin_user
ADMIN_PASS=$admin_pass

# Require player registration and approval before joining (default false)
SECURE_MODE=$secure_mode

# Port the app is exposed on
APP_PORT=$app_port

# DuckDNS - optional
DUCKDNS_SUBDOMAINS=$duck_sub
DUCKDNS_TOKEN=$duck_tok

# Timezone for DuckDNS container
TZ=$tz
"

  # Root .env is only used by docker-compose for variable substitution -
  # it gets the non-secret values only (no JWT_SECRET / ADMIN_PASS).
  root_env_content="APP_PORT=$app_port
DUCKDNS_SUBDOMAINS=$duck_sub
DUCKDNS_TOKEN=$duck_tok
TZ=$tz
"

  printf '%s' "$env_content" > ./backend/.env
  printf '%s' "$root_env_content" > ./.env

  echo ""
  green "  Configuration written to backend/.env and .env"
else
  env_content="JWT_SECRET=$jwt_secret
ADMIN_USER=$admin_user
ADMIN_PASS=$admin_pass

# Require player registration and approval before joining (default false)
SECURE_MODE=$secure_mode

# Port the Node server listens on
PORT=$app_port
"

  printf '%s' "$env_content" > ./backend/.env

  echo ""
  green "  Configuration written to backend/.env"
fi

# --- Connection info ---------------------------------------------------------

get_lan_ip() {
  local ip=""
  # Linux: interface that owns the default route
  ip=$(ip route get 1.1.1.1 2>/dev/null | awk '{for(i=1;i<=NF;i++) if($i=="src") print $(i+1)}' | head -n1)
  # macOS: getifaddr (guarded - 'ipconfig' is a different tool on Windows)
  if [ -z "$ip" ] && [ "$(uname)" = "Darwin" ]; then
    ip=$(ipconfig getifaddr en0 2>/dev/null)
    [ -z "$ip" ] && ip=$(ipconfig getifaddr en1 2>/dev/null)
  fi
  # Generic fallback: first private IPv4 from hostname
  [ -z "$ip" ] && ip=$(hostname -I 2>/dev/null | tr ' ' '\n' | grep -E '^(192\.168\.|10\.|172\.(1[6-9]|2[0-9]|3[01])\.)' | head -n1)
  echo "$ip"
}

show_connection_info() {
  local lan_ip
  lan_ip=$(get_lan_ip)
  echo ""
  green "  --- How to connect ---"
  echo ""
  echo "  This machine and your home network (LAN):"
  if [ -n "$lan_ip" ]; then
    green "     http://$lan_ip:$app_port"
  else
    green "     http://<this-machine's-IP>:$app_port"
    gray "     (couldn't auto-detect your LAN IP - try 'ip addr' or 'ifconfig')"
  fi
  echo ""
  if [ "$use_duck" = "y" ]; then
    echo "  Over the internet (players anywhere):"
    green "     http://$duck_sub.duckdns.org:$app_port"
    echo ""
    gray "     Internet play also needs:"
    gray "      1. A port-forward rule on your router: external $app_port -> this machine's IP"
    gray "      2. A firewall rule allowing inbound connections on port $app_port"
  elif [ "$mode" = "docker" ]; then
    gray "  Over the internet: not configured (re-run setup and enable DuckDNS,"
    gray "  or see the Connectivity section of the README for other options)."
  else
    gray "  Over the internet: see the 'Connectivity & Deployment' section of the"
    gray "  README - Cloudflare Tunnel is the easiest option for a manual install."
  fi
  echo ""
  echo "  Admin login:  $admin_user"
  echo ""
}

# --- Launch -----------------------------------------------------------------

echo ""
if [ "$mode" = "docker" ]; then
  if read_yesno "  Build and start City_Net now?" "y"; then
    echo ""
    green "  Starting containers (first build can take a few minutes)..."
    docker compose up -d --build

    echo ""
    green "  ============================================"
    green "        CITY_NET IS RUNNING"
    green "  ============================================"
    show_connection_info
  else
    echo ""
    green "  Setup complete. Start the app any time with:"
    echo "     docker compose up -d --build"
    show_connection_info
  fi
else
  if read_yesno "  Install dependencies and build now? (takes a few minutes)" "y"; then
    echo ""
    green "  Installing backend dependencies..."
    (cd backend && npm install)
    green "  Installing frontend dependencies..."
    (cd frontend && npm install)
    green "  Building frontend..."
    (cd frontend && npm run build)

    echo ""
    green "  ============================================"
    green "        CITY_NET IS BUILT"
    green "  ============================================"
    show_connection_info
    yellow "  NOTE: with a manual install the server runs in this terminal."
    yellow "  Closing the terminal stops City_Net. It will not restart on reboot."
    echo ""
    if read_yesno "  Start the server now?" "y"; then
      echo ""
      green "  Starting City_Net... (press Ctrl+C to stop)"
      cd backend && exec node server.js
    else
      echo ""
      green "  Start the server any time with:"
      echo "     cd backend && node server.js"
      echo ""
    fi
  else
    echo ""
    green "  Setup complete. Install and run manually with:"
    echo "     cd backend && npm install"
    echo "     cd frontend && npm install && npm run build"
    echo "     cd backend && node server.js"
    show_connection_info
    yellow "  NOTE: with a manual install the server runs in a terminal."
    yellow "  Closing that terminal stops City_Net."
    echo ""
  fi
fi
