#!/usr/bin/env bash
#
# auto-commit.sh — watches output/ for new captured images and auto-commits
# + pushes them to GitHub on a fixed interval.
#
# Usage:
#   ./scripts/auto-commit.sh start [interval_seconds]   # default 90s
#   ./scripts/auto-commit.sh stop
#   ./scripts/auto-commit.sh status
#   ./scripts/auto-commit.sh once                       # single cycle (no loop)
#
# Logs to scripts/auto-commit.log
# PID file at scripts/auto-commit.pid
#
set -euo pipefail

ROOT="/home/z/my-project"
cd "$ROOT"

LOG="$ROOT/scripts/auto-commit.log"
PIDFILE="$ROOT/scripts/auto-commit.pid"
INTERVAL="${2:-90}"  # seconds between cycles, default 90

log() {
  # When daemonized, stdout is already redirected to $LOG by nohup, so we
  # just echo (no tee — that would double-write). When run interactively
  # (status/once), echo goes to the terminal as expected.
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"
}

is_running() {
  if [[ -f "$PIDFILE" ]]; then
    local pid
    pid=$(cat "$PIDFILE" 2>/dev/null || echo "")
    if [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null; then
      return 0
    fi
  fi
  return 1
}

# ---------------------------------------------------------------- single cycle
run_once() {
  log "── cycle start ──"

  # Only look at changes under output/ (we don't auto-commit code changes).
  local changed
  changed=$(git status --porcelain -- output/ 2>/dev/null | wc -l)

  if [[ "$changed" -eq 0 ]]; then
    log "no new files in output/ — skipping"
    return 0
  fi

  log "detected $changed new/changed file(s) in output/"

  # Stage only output/ so we never accidentally commit code mid-edit.
  git add output/ 2>>"$LOG"

  # Build a short descriptive commit message with category breakdown.
  local cats
  cats=$(git diff --cached --name-only -- output/ \
    | sed 's#^output/##; s#/.*##' \
    | sort -u \
    | paste -sd, -)
  local now
  now=$(date '+%Y-%m-%d %H:%M:%S')

  local msg="feat(auto): capture update ${now} [${cats}]"

  if git commit -m "$msg" >>"$LOG" 2>&1; then
    log "committed: $msg"
  else
    log "ERROR: git commit failed"
    return 1
  fi

  # Push (retry up to 3 times in case of transient network blips).
  local attempt=1
  while [[ $attempt -le 3 ]]; do
    if git push origin main >>"$LOG" 2>&1; then
      log "pushed to origin/main (attempt $attempt)"
      return 0
    fi
    log "push attempt $attempt failed — retrying in 5s..."
    sleep 5
    attempt=$((attempt + 1))
  done

  log "ERROR: push failed after 3 attempts"
  return 1
}

# ---------------------------------------------------------------- loop daemon
run_loop() {
  if is_running; then
    log "already running (PID $(cat "$PIDFILE"))"
    exit 1
  fi

  log "========================================"
  log "auto-commit daemon starting"
  log "  interval: ${INTERVAL}s"
  log "  watch:    output/"
  log "  remote:   origin/main"
  log "  log:      $LOG"
  log "========================================"

  echo $$ > "$PIDFILE"
  trap 'log "daemon stopping (PID $$)"; rm -f "$PIDFILE"; exit 0' INT TERM EXIT

  # Run an immediate first cycle so the user sees action right away.
  run_once || true

  while true; do
    sleep "$INTERVAL"
    run_once || true
  done
}

# ---------------------------------------------------------------- stop
stop_daemon() {
  if ! is_running; then
    log "not running"
    rm -f "$PIDFILE"
    exit 0
  fi
  local pid
  pid=$(cat "$PIDFILE")
  log "stopping daemon (PID $pid)..."
  kill "$pid" 2>/dev/null || true
  # Give it a moment to clean up its PIDfile
  sleep 1
  if kill -0 "$pid" 2>/dev/null; then
    log "force-killing PID $pid"
    kill -9 "$pid" 2>/dev/null || true
  fi
  rm -f "$PIDFILE"
  log "stopped"
}

# ---------------------------------------------------------------- status
show_status() {
  if is_running; then
    local pid
    pid=$(cat "$PIDFILE")
    echo "✓ running (PID $pid)"
    echo "  interval: ${INTERVAL}s"
    echo "  log:      $LOG"
    echo ""
    echo "last 10 log lines:"
    tail -10 "$LOG" 2>/dev/null || echo "  (no log yet)"
  else
    echo "✗ not running"
    rm -f "$PIDFILE" 2>/dev/null || true
  fi
}

# ---------------------------------------------------------------- dispatch
case "${1:-status}" in
  start)
    if is_running; then
      log "already running (PID $(cat "$PIDFILE"))"
      show_status
      exit 0
    fi
    # Fully detach: nohup + setsid so the daemon survives the parent shell
    # exiting. Redirect all output to the log file.
    nohup setsid bash "$0" _daemon "$INTERVAL" >>"$LOG" 2>&1 &
    disown
    sleep 2
    show_status
    ;;
  _daemon)
    # Internal entry point used by `start` — runs the loop in the background.
    run_loop
    ;;
  stop)
    stop_daemon
    ;;
  status)
    show_status
    ;;
  once)
    run_once
    ;;
  restart)
    stop_daemon || true
    sleep 1
    nohup setsid bash "$0" _daemon "$INTERVAL" >>"$LOG" 2>&1 &
    disown
    sleep 2
    show_status
    ;;
  *)
    echo "Usage: $0 {start [interval]|stop|status|once|restart}" >&2
    exit 2
    ;;
esac
