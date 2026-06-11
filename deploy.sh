#!/bin/bash
set -e

REMOTE_HOST="root@87.99.134.152"
REMOTE_DIR="~/cyg-server"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "==> Building locally..."
cd "$SCRIPT_DIR"
npm run build

echo "==> Committing and pushing (including dist/)..."
git add -A
if git diff --cached --quiet; then
  echo "Nothing new to commit, pushing anyway..."
else
  git commit -m "${1:-deploy $(date '+%Y-%m-%d %H:%M')}"
fi
git push

echo "==> Pulling on server..."
ssh "$REMOTE_HOST" "cd $REMOTE_DIR && git pull origin main"

echo "==> Installing dependencies..."
ssh "$REMOTE_HOST" "cd $REMOTE_DIR && npm ci --omit=dev"

echo "==> Regenerating Prisma client..."
ssh "$REMOTE_HOST" "cd $REMOTE_DIR && npx prisma generate"

echo "==> Restarting server..."
ssh "$REMOTE_HOST" "cd $REMOTE_DIR && pm2 restart all || pm2 start dist/src/main.js --name backend"

echo "==> Done."
