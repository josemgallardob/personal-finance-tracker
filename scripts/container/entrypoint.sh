#!/bin/sh
# Container entry point.
#
# `exec` keeps the Node process as PID 1 so the runtime delivers SIGTERM
# directly to the startup wrapper, which forwards it to the server child and
# lets SQLite close cleanly. The react-server condition matches every other
# repository command that loads server-only modules.
set -eu

exec node --conditions=react-server --import tsx scripts/start-server.ts "$@"
