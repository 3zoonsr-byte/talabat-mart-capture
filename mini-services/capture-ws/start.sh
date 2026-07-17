#!/usr/bin/env bash
# Start / stop / restart the capture-ws mini-service (port 3003) as a daemon
# that survives shell exits. Uses start-stop-daemon for proper detachment.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PIDFILE="$SCRIPT_DIR/capture-ws.pid"
LOGFILE="$SCRIPT_DIR/capture-ws.log"

is_running() {
  [ -f "$PIDFILE" ] && kill -0 "$(cat "$PIDFILE" 2>/dev/null)" 2>/dev/null
}

case "${1:-start}" in
  start)
    if is_running; then
      echo "capture-ws already running (pid $(cat "$PIDFILE"))"
      exit 0
    fi
    echo "starting capture-ws..."
    cd "$SCRIPT_DIR"
    start-stop-daemon --start --background --make-pidfile \
      --pidfile "$PIDFILE" --stdout "$LOGFILE" --stderr "$LOGFILE" \
      --exec /usr/local/bin/bun -- index.ts
    sleep 0.5
    if is_running; then
      echo "capture-ws started (pid $(cat "$PIDFILE"))"
    else
      echo "capture-ws FAILED to start - check $LOGFILE" >&2
      exit 1
    fi
    ;;
  stop)
    if is_running; then
      echo "stopping capture-ws (pid $(cat "$PIDFILE"))..."
      start-stop-daemon --stop --pidfile "$PIDFILE" --retry TERM/2/KILL/1
      rm -f "$PIDFILE"
      echo "stopped"
    else
      echo "capture-ws not running"
    fi
    ;;
  restart)
    "$0" stop || true
    "$0" start
    ;;
  status)
    if is_running; then
      echo "capture-ws running (pid $(cat "$PIDFILE"))"
    else
      echo "capture-ws not running"
      exit 1
    fi
    ;;
  *)
    echo "usage: $0 {start|stop|restart|status}" >&2
    exit 2
    ;;
esac
