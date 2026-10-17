#!/usr/bin/env bash
set -euo pipefail

src=$(cd "$(dirname "$0")/.." && pwd)
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

export PATH="$src/node_modules/.bin:$PATH"
export GIT_AUTHOR_NAME=test GIT_AUTHOR_EMAIL=test@example.com
export GIT_COMMITTER_NAME=test GIT_COMMITTER_EMAIL=test@example.com
export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1

file=scripts/file.ts

lines() {
	local name
	for name in "$@"; do
		case "$name" in
		//*) printf '%s\n' "$name" ;;
		*!) printf 'export const %s = {x:1};\n' "${name%!}" ;;
		*+) printf 'export const %s = { x: 1 };\n' "${name%+}" ;;
		*) printf 'export const %s = 1;\n' "$name" ;;
		esac
	done
}

stage_all_but_last_hunk() {
	git diff -U0 -- "$1" | sed '/^@@ -8 /,$d' | git apply --cached --unidiff-zero --whitespace=nowarn
}

repo() {
	rm -rf "$work/repo"
	mkdir -p "$work/repo/.husky" "$work/repo/.git-hooks" "$work/repo/scripts"
	cd "$work/repo"
	git init --quiet
	cp "$src/.husky/pre-commit" .husky/pre-commit
	cp "$src/lint-staged.config.ts" "$src/biome.json" "$src/no-comments.json" .
	echo '{"type":"module"}' >package.json
	printf '#!/bin/sh\nexec sh -e .husky/pre-commit\n' >.git-hooks/pre-commit
	chmod +x .git-hooks/pre-commit
	git config core.hooksPath .git-hooks
	lines a b c d e f g h >"$file"
	git add .
	git commit --quiet --no-verify -m init
}

commits() {
	git rev-list --count HEAD
}

total=0
passed=0

run() {
	local name="$1"
	shift
	total=$((total + 1))
	set +e
	(
		set -e
		"$@"
	) >"$work/log" 2>&1
	local status=$?
	set -e
	if [ "$status" -eq 0 ]; then
		passed=$((passed + 1))
		echo "  PASS: $name"
	else
		echo "  FAIL: $name" >&2
		sed 's/^/    /' "$work/log" >&2
	fi
}

keeps_unstaged_hunks() {
	repo
	lines A b c d e f g H >"$file"
	stage_all_but_last_hunk "$file"
	git commit --quiet -m staged
	[ "$(git show "HEAD:$file")" = "$(lines A b c d e f g h)" ]
	[ "$(git diff --cached --name-only)" = "" ]
	[ "$(cat "$file")" = "$(lines A b c d e f g H)" ]
}

fixes_fully_staged_files() {
	repo
	lines '// note' a b! c d e f g h >"$file"
	git add "$file"
	git commit --quiet -m full
	[ "$(git show "HEAD:$file")" = "$(lines a b+ c d e f g h)" ]
	[ -z "$(git status --porcelain)" ]
}

fixes_the_staged_hunks_of_a_partly_staged_file() {
	repo
	lines '// note' a b! c d e f g H >"$file"
	stage_all_but_last_hunk "$file"
	git commit --quiet -m partial
	[ "$(git show "HEAD:$file")" = "$(lines a b+ c d e f g h)" ]
	[ "$(cat "$file")" = "$(lines a b+ c d e f g H)" ]
	[ "$(git diff --cached --name-only)" = "" ]
}

refuses_a_fix_that_clashes_with_an_unstaged_hunk() {
	repo
	lines a b c d! e f g h >"$file"
	git add "$file"
	lines a b c D! e f g h >"$file"
	local index
	index=$(git rev-parse ":$file")
	cp "$file" "$work/before"
	if git commit --quiet -m clash; then
		return 1
	fi
	[ "$(commits)" -eq 1 ]
	[ "$(git rev-parse ":$file")" = "$index" ]
	cmp -s "$file" "$work/before"
}

refuses_a_staged_comment_that_an_unstaged_hunk_removes() {
	repo
	lines a b c d e f g '// note' >"$file"
	git add "$file"
	lines a b c d e f g h >"$file"
	if git commit --quiet -m hidden; then
		return 1
	fi
	[ "$(commits)" -eq 1 ]
	[ "$(git show ":$file")" = "$(lines a b c d e f g '// note')" ]
	[ "$(cat "$file")" = "$(lines a b c d e f g h)" ]
}

takes_paths_literally() {
	repo
	lines a >scripts/i.ts
	lines '// note' a >'scripts/[id] x.ts'
	git add scripts
	git commit --quiet -m literal
	[ "$(git show 'HEAD:scripts/[id] x.ts')" = "$(lines a)" ]
	[ "$(git show HEAD:scripts/i.ts)" = "$(lines a)" ]
	[ -z "$(git status --porcelain)" ]
}

echo "running pre-commit hook tests..."
run "a commit leaves the unstaged hunks of a file unstaged" keeps_unstaged_hunks
run "the fixers fix a fully staged file in the commit and on disk" fixes_fully_staged_files
run "the fixers fix the staged hunks of a partly staged file" fixes_the_staged_hunks_of_a_partly_staged_file
run "a fix that clashes with an unstaged hunk fails the commit and changes nothing" refuses_a_fix_that_clashes_with_an_unstaged_hunk
run "a staged comment that an unstaged hunk removes fails the commit" refuses_a_staged_comment_that_an_unstaged_hunk_removes
run "a path with glob characters and a space is taken literally" takes_paths_literally

echo "$passed/$total tests passed"
[ "$passed" -eq "$total" ]
