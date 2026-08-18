#!/usr/bin/env bash
# Runs the editors/nvim Lua test suite headless via plenary.nvim's busted
# runner. Vendors plenary into vendor/ (gitignored) on first run, pinned to a
# known-good commit so runs are reproducible.
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# Vendored as a sibling of tests/, not inside it, so PlenaryBustedDirectory
# (which scans $DIR recursively) doesn't also run plenary's own test suite.
VENDOR="$DIR/../.vendor"
PLENARY="$VENDOR/plenary.nvim"
PLENARY_COMMIT="74b06c6c75e4eeb3108ec01852001636d85a932b"

if [ ! -d "$PLENARY" ]; then
	mkdir -p "$VENDOR"
	git clone --quiet https://github.com/nvim-lua/plenary.nvim "$PLENARY"
	git -C "$PLENARY" checkout --quiet "$PLENARY_COMMIT"
fi

nvim --headless --noplugin -u "$DIR/minimal_init.lua" \
	-c "PlenaryBustedDirectory $DIR { minimal_init = '$DIR/minimal_init.lua' }"
