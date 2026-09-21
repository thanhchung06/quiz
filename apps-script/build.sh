#!/usr/bin/env bash
# Bundles the apps-script TypeScript sources into a single plain-JS file
# suitable for pasting directly into the Apps Script online editor (script.google.com).
# Apps Script has no module system, so this produces one global `doPost`
# function rather than an ES module export.
set -euo pipefail
cd "$(dirname "$0")/.."

node_modules/.bin/esbuild apps-script/src/main.ts \
  --bundle --format=iife --global-name=QuizAppSync \
  --target=es2019 --outfile=apps-script/dist/Code.js

{
  cat apps-script/dist/Code.js
  cat apps-script/src/test-helper.gs.js
} > apps-script/dist/Code.gs.js

echo "Wrote apps-script/dist/Code.gs.js — paste this into the Apps Script editor."
