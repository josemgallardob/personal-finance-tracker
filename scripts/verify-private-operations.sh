#!/bin/sh
# Verify the systemd templates after replacing their only host-path placeholder.
# This never installs, enables, starts, reloads or changes a host unit.
set -eu

root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
temporary_directory=$(mktemp -d)
trap 'rm -rf "$temporary_directory"' EXIT HUP INT TERM

for template in \
  personal-finance-recurring.service \
  personal-finance-recurring.timer
do
  sed "s|__APP_DIRECTORY__|$root|g" \
    "$root/operations/systemd/$template" >"$temporary_directory/$template"
done

systemd-analyze verify \
  "$temporary_directory/personal-finance-recurring.service" \
  "$temporary_directory/personal-finance-recurring.timer"
