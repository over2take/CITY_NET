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

if ! command -v docker >/dev/null 2>&1; then
  yellow "  Docker was not found on your system."
  yellow "  Install Docker first: https://docs.docker.com/get-docker/"
  yellow "  Then re-run this script."
  exit 1
fi

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
gray "  App port: the port players connect on. 80 gives the cleanest URL,"
gray "  but many home ISPs block inbound 80, so 8080 is the safe default."
app_port=$(read_default "  App port" "8080")

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

# --- Write .env -------------------------------------------------------------

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

# --- Launch -----------------------------------------------------------------

echo ""
if read_yesno "  Build and start City_Net now?" "y"; then
  echo ""
  green "  Starting containers (first build can take a few minutes)..."
  docker compose up -d --build

  echo ""
  green "  ============================================"
  green "        CITY_NET IS RUNNING"
  green "  ============================================"
  echo ""
  echo "  On this machine:   http://localhost:$app_port"
  echo "  On your network:   http://<your-lan-ip>:$app_port"
  if [ "$use_duck" = "y" ]; then
    echo "  Over the internet: http://$duck_sub.duckdns.org:$app_port"
    echo ""
    gray "  (Internet play also needs a port-forward for $app_port on your router"
    gray "   and a firewall rule allowing inbound $app_port.)"
  fi
  echo ""
  echo "  Admin login:  $admin_user"
  echo ""
else
  echo ""
  green "  Setup complete. Start the app any time with:"
  echo "     docker compose up -d --build"
  echo ""
fi
