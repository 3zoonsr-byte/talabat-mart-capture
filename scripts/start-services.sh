#!/usr/bin/env bash
# Start all capture services in the background, detached from any shell.
set -e
ROOT="/home/z/my-project"
cd "$ROOT"

# Kill any stale instances
pkill -f "next dev -p 3000" 2>/dev/null || true
pkill -f "capture-ws/index" 2>/dev/null || true
sleep 1

# Start dev server (Next.js)
nohup bun run dev > "$ROOT/dev.log" 2>&1 </dev/null &
DEV_PID=$!
echo "dev server PID: $DEV_PID"

# Start WS service
cd "$ROOT/mini-services/capture-ws"
nohup bun run dev > "$ROOT/logs/capture-ws.log" 2>&1 </dev/null &
WS_PID=$!
echo "ws service PID: $WS_PID"

cd "$ROOT"

# Start auto-commit daemon
rm -f "$ROOT/scripts/auto-commit.pid"
nohup bash "$ROOT/scripts/auto-commit.sh" _daemon 90 > "$ROOT/scripts/auto-commit.log" 2>&1 </dev/null &
AC_PID=$!
echo $AC_PID > "$ROOT/scripts/auto-commit.pid"
echo "auto-commit PID: $AC_PID"

# Wait and verify
sleep 12
echo ""
echo "=== STATUS ==="
if kill -0 $DEV_PID 2>/dev/null; then echo "✓ dev server alive (PID $DEV_PID)"; else echo "✗ dev server DEAD"; fi
if kill -0 $WS_PID 2>/dev/null; then echo "✓ ws service alive (PID $WS_PID)"; else echo "✗ ws service DEAD"; fi
if kill -0 $AC_PID 2>/dev/null; then echo "✓ auto-commit alive (PID $AC_PID)"; else echo "✗ auto-commit DEAD"; fi
echo ""
echo "=== dev.log tail ==="
tail -5 "$ROOT/dev.log" 2>/dev/null || true
