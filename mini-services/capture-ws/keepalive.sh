#!/usr/bin/env bash
while true; do
  /usr/local/bin/bun /home/z/my-project/mini-services/capture-ws/index.ts 2>&1
  echo "[$(date)] WS exited, restarting in 2s..." >> /home/z/my-project/mini-services/capture-ws/capture-ws.log
  sleep 2
done
