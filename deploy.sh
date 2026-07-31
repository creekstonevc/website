#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="/root/creekstone-website"
WEB_ROOT="/var/www/creekstone"
NEXT_WEB_ROOT="/var/www/creekstone.next"
BACKUP_ROOT="/root/creekstone-deploy-backups"
SITE_CONF="/etc/nginx/sites-enabled/creekstone"
AGENT_SNIPPET="/etc/nginx/snippets/creekstone-agent.conf"
DEPLOY_STAMP="$(date +%Y%m%d-%H%M%S)"
DEPLOY_BACKUP="$BACKUP_ROOT/$DEPLOY_STAMP"

if [ "$(id -u)" -ne 0 ]; then
  echo "deploy.sh must run as root on the Creekstone server." >&2
  exit 1
fi

if [ ! -d "$PROJECT_DIR" ] || [ ! -f "$PROJECT_DIR/package.json" ]; then
  echo "Project directory is missing: $PROJECT_DIR" >&2
  exit 1
fi

cd "$PROJECT_DIR"

echo "==> Installing locked dependencies"
npm ci --prefer-offline

echo "==> Building static Next.js export"
npm run build

if [ ! -f "$PROJECT_DIR/out/index.html" ] || [ ! -f "$PROJECT_DIR/out/agent/index.html" ]; then
  echo "Static export is incomplete; expected homepage and /agent/ output." >&2
  exit 1
fi

echo "==> Preserving current web root and Nginx configuration"
mkdir -p "$DEPLOY_BACKUP"
if [ -d "$WEB_ROOT" ]; then
  cp -a "$WEB_ROOT" "$DEPLOY_BACKUP/webroot"
fi
if [ -f "$SITE_CONF" ]; then
  cp -a "$SITE_CONF" "$DEPLOY_BACKUP/creekstone.nginx.conf"
fi
if [ -f "$AGENT_SNIPPET" ]; then
  cp -a "$AGENT_SNIPPET" "$DEPLOY_BACKUP/creekstone-agent.conf"
fi

echo "==> Refreshing same-origin Agent API proxy"
BOIDS_API_KEY=""
if [ -f "$PROJECT_DIR/.env.local" ]; then
  BOIDS_API_KEY="$(sed -n 's/^BOIDS_API_KEY=//p' "$PROJECT_DIR/.env.local" | tail -n 1)"
fi

if [ -z "$BOIDS_API_KEY" ]; then
  echo "BOIDS_API_KEY is missing from $PROJECT_DIR/.env.local" >&2
  exit 1
fi

mkdir -p /etc/nginx/snippets
cat > "$AGENT_SNIPPET" <<EOF
location /api/agent/ {
    proxy_pass https://staging-api.boids.so/v1/;
    proxy_http_version 1.1;
    proxy_set_header Host staging-api.boids.so;
    proxy_set_header Authorization "Bearer $BOIDS_API_KEY";
    proxy_set_header Connection "";
    proxy_ssl_server_name on;
    proxy_buffering off;
    proxy_cache off;
    proxy_read_timeout 300s;
    add_header X-Accel-Buffering no;
}
EOF
chmod 600 "$AGENT_SNIPPET"

echo "==> Staging exported site"
if [ -e "$NEXT_WEB_ROOT" ]; then
  rm -rf -- "$NEXT_WEB_ROOT"
fi
mkdir -p "$NEXT_WEB_ROOT"
cp -a "$PROJECT_DIR/out/." "$NEXT_WEB_ROOT/"
chown -R www-data:www-data "$NEXT_WEB_ROOT"

echo "==> Updating Nginx static entry point"
python3 - "$SITE_CONF" <<'PY'
from pathlib import Path
import sys

path = Path(sys.argv[1])
text = path.read_text()
text = text.replace("index index-b.html index.html;", "index index.html;")
text = text.replace("try_files $uri $uri/ /index-b.html;", "try_files $uri $uri/ $uri.html /index.html;")
text = text.replace("try_files $uri $uri/ /index.html;", "try_files $uri $uri/ $uri.html /index.html;")
if "location = /index-b.html" not in text:
    legacy_entry = """    location = /index-b.html {
        try_files /index.html =404;
        add_header Cache-Control "no-cache";
    }

"""
    text = text.replace("    location / {\n", legacy_entry + "    location / {\n", 1)
path.write_text(text)
PY

nginx -t

echo "==> Activating release"
if [ -d "$WEB_ROOT" ]; then
  rm -rf -- "$WEB_ROOT"
fi
mv "$NEXT_WEB_ROOT" "$WEB_ROOT"

nginx -t
systemctl reload nginx

echo "==> Deployment complete"
echo "    Site: https://creekstonevc.com/"
echo "    Agent: https://creekstonevc.com/agent/"
echo "    Rollback snapshot: $DEPLOY_BACKUP"
