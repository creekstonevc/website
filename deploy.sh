#!/usr/bin/env bash
set -euo pipefail
umask 077

PROJECT_DIR="/root/creekstone-website"
WEB_ROOT="/var/www/creekstone"
NEXT_WEB_ROOT="/var/www/creekstone.next"
BACKUP_ROOT="/root/creekstone-deploy-backups"
SITE_CONF="/etc/nginx/sites-enabled/creekstone"
AGENT_SNIPPET="/etc/nginx/snippets/creekstone-agent.conf"
AGENT_LIMITS="/etc/nginx/conf.d/creekstone-agent-limits.conf"
GATEWAY_ROOT="/opt/creekstone-agent-gateway"
GATEWAY_ENV="/etc/creekstone-agent-gateway.env"
GATEWAY_SERVICE="/etc/systemd/system/creekstone-agent-gateway.service"
GATEWAY_USER="creekstone-gateway"
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

read_project_env() {
  local name="$1"
  sed -n "s/^${name}=//p" "$PROJECT_DIR/.env.local" 2>/dev/null | tail -n 1
}

read_gateway_env() {
  local name="$1"
  if [ ! -f "$GATEWAY_ENV" ]; then
    return 0
  fi
  sed -n "s/^${name}=//p" "$GATEWAY_ENV" 2>/dev/null | tail -n 1
}

cd "$PROJECT_DIR"

echo "==> Installing locked dependencies"
npm ci --prefer-offline

echo "==> Running gateway tests"
node --test gateway/*.test.mjs

echo "==> Building static Next.js export"
npm run build

if [ ! -f "$PROJECT_DIR/out/index.html" ] || [ ! -f "$PROJECT_DIR/out/agent/index.html" ]; then
  echo "Static export is incomplete; expected homepage and /agent/ output." >&2
  exit 1
fi

echo "==> Preserving current release and service configuration"
install -d -m 700 "$BACKUP_ROOT" "$DEPLOY_BACKUP"
if [ -d "$WEB_ROOT" ]; then
  cp -a "$WEB_ROOT" "$DEPLOY_BACKUP/webroot"
fi
for file in "$SITE_CONF" "$AGENT_SNIPPET" "$AGENT_LIMITS" "$GATEWAY_ENV" "$GATEWAY_SERVICE"; do
  if [ -f "$file" ]; then
    cp -a "$file" "$DEPLOY_BACKUP/$(basename "$file")"
  fi
done

echo "==> Installing the private Agent Gateway"
BOIDS_API_KEY="$(read_project_env BOIDS_API_KEY)"
BYTEPLUS_TTS_API_KEY="$(read_project_env BYTEPLUS_TTS_API_KEY)"
BYTEPLUS_TTS_SPEAKER_ID="$(read_project_env BYTEPLUS_TTS_SPEAKER_ID)"
BYTEPLUS_TTS_RESOURCE_ID="$(read_project_env BYTEPLUS_TTS_RESOURCE_ID)"
BOIDS_BASE_URL="$(read_project_env BOIDS_BASE_URL)"
BOIDS_AGENT_MODEL="$(read_project_env BOIDS_AGENT_MODEL)"
GATEWAY_SIGNING_SECRET="$(read_gateway_env GATEWAY_SIGNING_SECRET)"

if [ -z "$BOIDS_API_KEY" ]; then
  echo "BOIDS_API_KEY is missing from $PROJECT_DIR/.env.local" >&2
  exit 1
fi
if [ -z "$BYTEPLUS_TTS_API_KEY" ]; then
  echo "BYTEPLUS_TTS_API_KEY is missing from $PROJECT_DIR/.env.local" >&2
  exit 1
fi
if [ -z "$BYTEPLUS_TTS_SPEAKER_ID" ]; then
  echo "BYTEPLUS_TTS_SPEAKER_ID is missing from $PROJECT_DIR/.env.local" >&2
  exit 1
fi

BYTEPLUS_TTS_RESOURCE_ID="${BYTEPLUS_TTS_RESOURCE_ID:-seed-icl-2.0}"
BOIDS_BASE_URL="${BOIDS_BASE_URL:-https://api.boids.so/v1}"
BOIDS_AGENT_MODEL="${BOIDS_AGENT_MODEL:-agent:@qq1006775897-1-org/qq1006775897@9}"
GATEWAY_SIGNING_SECRET="${GATEWAY_SIGNING_SECRET:-$(openssl rand -hex 32)}"

if ! id "$GATEWAY_USER" >/dev/null 2>&1; then
  useradd --system --user-group --home-dir /nonexistent --shell /usr/sbin/nologin "$GATEWAY_USER"
fi

install -d -m 750 -o root -g "$GATEWAY_USER" "$GATEWAY_ROOT"
install -m 755 -o root -g root "$PROJECT_DIR/gateway/core.mjs" "$GATEWAY_ROOT/core.mjs"
install -m 755 -o root -g root "$PROJECT_DIR/gateway/server.mjs" "$GATEWAY_ROOT/server.mjs"

{
  printf 'GATEWAY_HOST=127.0.0.1\n'
  printf 'GATEWAY_PORT=8790\n'
  printf 'GATEWAY_ALLOWED_ORIGINS=https://creekstonevc.com,https://www.creekstonevc.com\n'
  printf 'GATEWAY_SIGNING_SECRET=%s\n' "$GATEWAY_SIGNING_SECRET"
  printf 'GATEWAY_CONVERSATION_TTL_MS=2592000000\n'
  printf 'GATEWAY_CONVERSATION_HISTORY_LIMIT=100\n'
  printf 'GATEWAY_BOOTSTRAP_PROMPT=Hi\n'
  printf 'BOIDS_API_KEY=%s\n' "$BOIDS_API_KEY"
  printf 'BOIDS_BASE_URL=%s\n' "$BOIDS_BASE_URL"
  printf 'BOIDS_AGENT_MODEL=%s\n' "$BOIDS_AGENT_MODEL"
  printf 'BYTEPLUS_TTS_API_KEY=%s\n' "$BYTEPLUS_TTS_API_KEY"
  printf 'BYTEPLUS_TTS_SPEAKER_ID=%s\n' "$BYTEPLUS_TTS_SPEAKER_ID"
  printf 'BYTEPLUS_TTS_RESOURCE_ID=%s\n' "$BYTEPLUS_TTS_RESOURCE_ID"
} > "$GATEWAY_ENV"
chown root:"$GATEWAY_USER" "$GATEWAY_ENV"
chmod 640 "$GATEWAY_ENV"
chmod 600 "$PROJECT_DIR/.env.local"

cat > "$GATEWAY_SERVICE" <<EOF
[Unit]
Description=Creekstone Agent Gateway
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$GATEWAY_USER
Group=$GATEWAY_USER
EnvironmentFile=$GATEWAY_ENV
ExecStart=/usr/bin/node $GATEWAY_ROOT/server.mjs
Restart=on-failure
RestartSec=2s
TimeoutStopSec=15s
UMask=0077
NoNewPrivileges=true
PrivateTmp=true
PrivateDevices=true
ProtectSystem=strict
ProtectHome=true
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectControlGroups=true
LockPersonality=true
RestrictAddressFamilies=AF_INET AF_INET6
CapabilityBoundingSet=

[Install]
WantedBy=multi-user.target
EOF
chmod 644 "$GATEWAY_SERVICE"

systemctl daemon-reload
systemctl enable --now creekstone-agent-gateway.service
systemctl restart creekstone-agent-gateway.service

for attempt in 1 2 3 4 5; do
  if curl --silent --fail http://127.0.0.1:8790/health >/dev/null; then
    break
  fi
  if [ "$attempt" -eq 5 ]; then
    systemctl status creekstone-agent-gateway.service --no-pager >&2
    exit 1
  fi
  sleep 1
done

echo "==> Constraining the public Agent API"
mkdir -p /etc/nginx/snippets /etc/nginx/conf.d
cat > "$AGENT_LIMITS" <<'EOF'
limit_req_zone $binary_remote_addr zone=creekstone_agent_conversation:10m rate=6r/m;
limit_req_zone $binary_remote_addr zone=creekstone_agent_response:10m rate=12r/m;
limit_req_zone $binary_remote_addr zone=creekstone_agent_tts:10m rate=6r/m;
limit_conn_zone $binary_remote_addr zone=creekstone_agent_connections:10m;
EOF
chmod 644 "$AGENT_LIMITS"

cat > "$AGENT_SNIPPET" <<'EOF'
location = /api/agent/conversations {
    limit_except POST { deny all; }
    limit_req zone=creekstone_agent_conversation burst=3 nodelay;
    limit_req_status 429;
    limit_conn creekstone_agent_connections 3;
    client_max_body_size 8k;

    proxy_pass http://127.0.0.1:8790/conversations;
    proxy_http_version 1.1;
    proxy_set_header Host 127.0.0.1;
    proxy_set_header Origin $http_origin;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header Connection "";
    proxy_connect_timeout 5s;
    proxy_read_timeout 30s;
    proxy_cache off;
}

location = /api/agent/responses {
    limit_except POST { deny all; }
    limit_req zone=creekstone_agent_response burst=8 nodelay;
    limit_req_status 429;
    limit_conn creekstone_agent_connections 3;
    client_max_body_size 64k;

    proxy_pass http://127.0.0.1:8790/responses;
    proxy_http_version 1.1;
    proxy_set_header Host 127.0.0.1;
    proxy_set_header Origin $http_origin;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header Connection "";
    proxy_connect_timeout 5s;
    proxy_read_timeout 310s;
    proxy_buffering off;
    proxy_cache off;
    add_header X-Accel-Buffering no;
}

location = /api/agent/tts {
    limit_except POST { deny all; }
    limit_req zone=creekstone_agent_tts burst=3 nodelay;
    limit_req_status 429;
    limit_conn creekstone_agent_connections 2;
    client_max_body_size 64k;

    proxy_pass http://127.0.0.1:8790/tts;
    proxy_http_version 1.1;
    proxy_set_header Host 127.0.0.1;
    proxy_set_header Origin $http_origin;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header Connection "";
    proxy_connect_timeout 5s;
    proxy_read_timeout 125s;
    proxy_cache off;
}

location /api/agent/ {
    return 404;
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
echo "    Gateway: 127.0.0.1:8790"
echo "    Rollback snapshot: $DEPLOY_BACKUP"
