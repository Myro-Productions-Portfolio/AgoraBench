#!/bin/sh
cd /Volumes/DevDrive-M4Pro/Projects/AgoraBench
export NODE_ENV=production

# Kill any orphaned process holding our port (safety net)
PORT="${PORT:-3001}"
lsof -ti :"$PORT" | xargs kill 2>/dev/null || true
sleep 1

exec ./node_modules/.bin/tsx src/core/server/index.ts
