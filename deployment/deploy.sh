#!/usr/bin/env sh

set -eu
umask 022

APP_DIR=/opt/11fgb-mcp
DEPLOY_BRANCH=main
ENV_FILE=/etc/11fgb-mcp.env
LOCK_DIR=/run/lock/11fgb-mcp-deploy
TARGET_SHA=${1:-}

log(){ printf '[11fgb-mcp-deploy] %s\n' "$*"; }
fail(){ log "ERROR: $*" >&2; exit 1; }

echo "$TARGET_SHA" | grep -Eq '^[0-9a-f]{40}$' || fail 'Expected a full lowercase commit SHA'
[ -d "$APP_DIR/.git" ] || fail "Git checkout not found: $APP_DIR"
[ -r "$ENV_FILE" ] || fail "Environment file not found: $ENV_FILE"
mkdir "$LOCK_DIR" 2>/dev/null || fail 'Another MCP deployment is already running'
trap 'rmdir "$LOCK_DIR" 2>/dev/null || true' EXIT

for command_name in git docker curl grep; do
	command -v "$command_name" >/dev/null || fail "Missing command: $command_name"
done

cd "$APP_DIR"
git fetch --prune origin "+refs/heads/$DEPLOY_BRANCH:refs/remotes/origin/$DEPLOY_BRANCH"
LATEST_SHA=$(git rev-parse "refs/remotes/origin/$DEPLOY_BRANCH")
[ "$TARGET_SHA" = "$LATEST_SHA" ] || { log "Skipping stale commit $TARGET_SHA; latest is $LATEST_SHA"; exit 0; }
git cat-file -e "$TARGET_SHA^{commit}" || fail 'Target commit is unavailable'

PREVIOUS_SHA=$(git rev-parse HEAD 2>/dev/null || true)
PREVIOUS_TAG=$(cat /var/lib/11fgb-mcp/current 2>/dev/null || true)
CANDIDATE_NAME="11fgb-mcp-candidate-$(printf %.12s "$TARGET_SHA")"

rollback(){
	code=$?
	trap - EXIT INT TERM HUP
	docker rm -f "$CANDIDATE_NAME" >/dev/null 2>&1 || true
	if [ -n "$PREVIOUS_TAG" ] && docker image inspect "11fgb-cleaning-tools:$PREVIOUS_TAG" >/dev/null 2>&1; then
		log "Restoring container image $PREVIOUS_TAG"
		[ -z "$PREVIOUS_SHA" ] || git reset --hard "$PREVIOUS_SHA" >/dev/null 2>&1 || true
		MCP_IMAGE_TAG="$PREVIOUS_TAG" docker compose up -d --no-build >/dev/null 2>&1 || true
	fi
	rmdir "$LOCK_DIR" 2>/dev/null || true
	exit "$code"
}
trap rollback EXIT INT TERM HUP

log "Checking out $TARGET_SHA"
git reset --hard "$TARGET_SHA"

log 'Building exact image'
MCP_IMAGE_TAG="$TARGET_SHA" docker compose build --pull

log 'Testing candidate on port 3401'
docker rm -f "$CANDIDATE_NAME" >/dev/null 2>&1 || true
docker run -d --rm \
	--name "$CANDIDATE_NAME" \
	--env-file "$ENV_FILE" \
	--memory 512m \
	--cpus 1 \
	--read-only \
	--tmpfs /tmp:size=32m,mode=1777 \
	--security-opt no-new-privileges \
	--cap-drop ALL \
	-p 127.0.0.1:3401:3400 \
	"11fgb-cleaning-tools:$TARGET_SHA" >/dev/null

attempt=0
until curl --fail --silent --max-time 4 http://127.0.0.1:3401/health | grep -q '"ok":true'; do
	attempt=$((attempt + 1))
	[ "$attempt" -lt 20 ] || fail 'Candidate health check failed'
	sleep 1
done

HANDSHAKE=$(curl --fail --silent --max-time 10 \
	-H 'Accept: application/json, text/event-stream' \
	-H 'Content-Type: application/json' \
	-H 'MCP-Protocol-Version: 2025-06-18' \
	--data '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"11fgb-deploy-check","version":"1.0.0"}}}' \
	http://127.0.0.1:3401/mcp)
printf '%s' "$HANDSHAKE" | grep -q '11fgb-cleaning-tools' || fail 'Candidate MCP handshake failed'
docker stop "$CANDIDATE_NAME" >/dev/null

log 'Switching production container'
MCP_IMAGE_TAG="$TARGET_SHA" docker compose up -d --no-build --remove-orphans
attempt=0
until curl --fail --silent --max-time 4 http://127.0.0.1:3400/health | grep -q '"ok":true'; do
	attempt=$((attempt + 1))
	[ "$attempt" -lt 20 ] || fail 'Production health check failed'
	sleep 1
done

mkdir -p /var/lib/11fgb-mcp
printf '%s\n' "$TARGET_SHA" > /var/lib/11fgb-mcp/current
install -m 0755 "$APP_DIR/deployment/deploy.sh" /usr/local/sbin/11fgb-mcp-deploy
install -m 0755 "$APP_DIR/deployment/ssh-command.sh" /usr/local/sbin/11fgb-mcp-deploy-ssh
docker image prune -a -f --filter label=io.11fgb.service=cleaning-tools --filter until=168h >/dev/null || true

trap - EXIT INT TERM HUP
rmdir "$LOCK_DIR" 2>/dev/null || true
log "Deployment completed: $TARGET_SHA"
