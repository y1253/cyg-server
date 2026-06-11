#!/bin/bash
set -e

REMOTE_HOST="root@87.99.134.152"
REMOTE_DIR="~/cyg-server"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "==> Building locally..."
cd "$SCRIPT_DIR"
npm run build

echo "==> Pulling latest code on server..."
ssh "$REMOTE_HOST" "cd $REMOTE_DIR && git stash && git pull origin main"

echo "==> Installing dependencies..."
ssh "$REMOTE_HOST" "cd $REMOTE_DIR && npm ci"

echo "==> Regenerating Prisma client..."
ssh "$REMOTE_HOST" "cd $REMOTE_DIR && npx prisma generate"

echo "==> Uploading build artifacts..."
scp -r "$SCRIPT_DIR/dist/" "$REMOTE_HOST:$REMOTE_DIR/"

echo "==> Pruning dev dependencies..."
ssh "$REMOTE_HOST" "cd $REMOTE_DIR && npm prune --omit=dev"

echo "==> Restarting server..."
ssh "$REMOTE_HOST" "cd $REMOTE_DIR && pm2 restart all || pm2 start dist/src/main.js --name cyg-server"

echo "==> Done."
