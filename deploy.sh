#!/bin/bash
set -e

REMOTE_HOST="root@87.99.134.152"
REMOTE_DIR="~/cyg-server"

echo "==> Pulling latest code on server..."
ssh "$REMOTE_HOST" "cd $REMOTE_DIR && git pull origin main"

echo "==> Installing dependencies..."
ssh "$REMOTE_HOST" "cd $REMOTE_DIR && npm ci --omit=dev"

echo "==> Regenerating Prisma client..."
ssh "$REMOTE_HOST" "cd $REMOTE_DIR && npx prisma generate"

echo "==> Building..."
ssh "$REMOTE_HOST" "cd $REMOTE_DIR && npm run build"

echo "==> Restarting server..."
ssh "$REMOTE_HOST" "cd $REMOTE_DIR && pm2 restart all || pm2 start dist/src/main.js --name cyg-server"

echo "==> Done."
