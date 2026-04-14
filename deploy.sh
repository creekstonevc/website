#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="/home/ubuntu/creekstone-website"
NGINX_ROOT="/var/www/creekstone"

cd "$PROJECT_DIR"

echo "==> Installing dependencies..."
npm ci --prefer-offline 2>/dev/null || npm install

echo "==> Building for production..."
npm run build

echo "==> Deploying to nginx root..."
sudo mkdir -p "$NGINX_ROOT"
sudo cp -r dist/* "$NGINX_ROOT/"

echo "==> Testing nginx config..."
sudo nginx -t

echo "==> Reloading nginx..."
sudo systemctl reload nginx

echo "==> Deploy complete! Site is live."
