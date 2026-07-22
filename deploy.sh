#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="/root/creekstone-website"
NGINX_ROOT="/var/www/creekstone"
DOMAIN="creekstonevc.com"
# Set CERTBOT_EMAIL to receive Let's Encrypt expiry notices; renewal is
# automatic via certbot's systemd timer either way.
CERTBOT_EMAIL="${CERTBOT_EMAIL:-}"

SUDO=""
if [ "$(id -u)" -ne 0 ]; then
    SUDO="sudo"
fi

cd "$PROJECT_DIR"

echo "==> Installing dependencies..."
npm ci --prefer-offline 2>/dev/null || npm install

echo "==> Building for production..."
npm run build

echo "==> Deploying to nginx root..."
$SUDO mkdir -p "$NGINX_ROOT"
$SUDO cp -r dist/* "$NGINX_ROOT/"

echo "==> Configuring agent API proxy..."
# The AI agent chat calls /api/agent/* same-origin; nginx forwards it to the
# Boids API and injects the key server-side so it never reaches the browser.
BOIDS_API_KEY="$(grep -oP '^BOIDS_API_KEY=\K.*' "$PROJECT_DIR/.env.local" 2>/dev/null || true)"
SITE_CONF="/etc/nginx/sites-enabled/creekstone"
if [ -n "$BOIDS_API_KEY" ] && [ -f "$SITE_CONF" ]; then
    $SUDO mkdir -p /etc/nginx/snippets
    $SUDO tee /etc/nginx/snippets/creekstone-agent.conf >/dev/null <<EOF
location /api/agent/ {
    proxy_pass https://staging-api.boids.so/v1/;
    proxy_http_version 1.1;
    proxy_set_header Host staging-api.boids.so;
    proxy_set_header Authorization "Bearer $BOIDS_API_KEY";
    proxy_set_header Connection "";
    proxy_ssl_server_name on;
    proxy_buffering off;
    proxy_read_timeout 300s;
}
EOF
    if ! grep -q "creekstone-agent.conf" "$SITE_CONF"; then
        $SUDO sed -i '/root \/var\/www\/creekstone;/a\    include snippets/creekstone-agent.conf;' "$SITE_CONF"
    fi
else
    echo "    (skipped: BOIDS_API_KEY missing from .env.local or site config not found)"
fi

echo "==> Testing nginx config..."
$SUDO nginx -t

echo "==> Reloading nginx..."
$SUDO systemctl reload nginx

if ! command -v certbot >/dev/null 2>&1; then
    echo "==> Installing certbot..."
    $SUDO apt-get update -qq
    $SUDO env DEBIAN_FRONTEND=noninteractive apt-get install -y -qq certbot python3-certbot-nginx
fi

if [ ! -d "/etc/letsencrypt/live/$DOMAIN" ]; then
    echo "==> Obtaining HTTPS certificate for $DOMAIN..."
    if [ -n "$CERTBOT_EMAIL" ]; then
        EMAIL_ARGS=(--email "$CERTBOT_EMAIL")
    else
        EMAIL_ARGS=(--register-unsafely-without-email)
    fi
    $SUDO certbot --nginx --non-interactive --agree-tos "${EMAIL_ARGS[@]}" \
        --redirect -d "$DOMAIN" -d "www.$DOMAIN"
else
    echo "==> Certificate already present; certbot's timer handles renewal."
fi

echo "==> Deploy complete! Site is live at https://$DOMAIN"
