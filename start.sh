#!/usr/bin/env bash
# City_Net - start the app (manual/Node.js install)
# Docker users don't need this: use  docker compose up -d  instead.

cd "$(dirname "$0")"

if [ ! -f "./backend/.env" ]; then
  echo "  No configuration found (backend/.env missing)."
  echo "  Run setup first:  bash setup.sh"
  exit 1
fi

if [ ! -d "./frontend/dist" ]; then
  echo "  Frontend is not built yet (frontend/dist missing)."
  echo "  Run setup first:  bash setup.sh"
  echo "  Or build manually:  cd frontend && npm install && npm run build"
  exit 1
fi

echo "  Starting City_Net... (press Ctrl+C to stop; closing this terminal stops the app)"
cd backend && exec node server.js
