#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="/home/ubuntu/creekstone-website"

cd "$PROJECT_DIR"

echo "==> Installing dependencies..."
npm ci

echo "==> Building for production..."
npm run build

echo "==> Stopping old PM2 serve process (if any)..."
pm2 delete creekstone 2>/dev/null || true
pm2 save 2>/dev/null || true

echo "==> Testing nginx config..."
sudo nginx -t

echo "==> Reloading nginx..."
sudo systemctl reload nginx

echo "==> Deploy complete! Site is live at https://creekstone.dev"
