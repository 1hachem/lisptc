#!/usr/bin/env bash
set -euo pipefail

src=$(cd "${1:-$(dirname "$0")/../..}" && pwd)
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

mkdir -p "$work/bin"
cat >"$work/bin/no-comments" <<'EOF'
#!/bin/sh
sed '/^\/\//d'
EOF
cat >"$work/bin/biome" <<'EOF'
#!/bin/sh
while [ "$1" != -- ]; do
	[ "$1" != --config-path ] || [ -f "$2/biome.json" ] || exit 3
	shift
done
shift
sed -i 's/[[:space:]]*$//' "$@"
EOF
chmod +x "$work/bin/no-comments" "$work/bin/biome"
export PATH="$work/bin:$PATH"
export GIT_AUTHOR_NAME=test GIT_AUTHOR_EMAIL=test@example.com
export GIT_COMMITTER_NAME=test GIT_COMMITTER_EMAIL=test@example.com
export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1

lines() {
	printf '%s\n' "$@"
}

stage_all_but_last_hunk() {
	git diff -U0 -- "$1" | sed '/^@@ -8 /,$d' | git apply --cached --unidiff-zero --whitespace=nowarn
}

repo() {
	rm -rf "$work/repo"
	mkdir -p "$work/repo/.husky" "$work/repo/.git-hooks"
	cd "$work/repo"
	git init --quiet
	cp "$src/.husky/pre-commit" .husky/pre-commit
	printf '#!/bin/sh\nexec sh -e .husky/pre-commit\n' >.git-hooks/pre-commit
	chmod +x .git-hooks/pre-commit
	git config core.hooksPath .git-hooks
	echo '{}' >biome.json
	lines a b c d e f g h >file.ts
	git add .
	git commit --quiet --no-verify -m init
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
	)
	local status=$?
	set -e
	if [ "$status" -eq 0 ]; then
		passed=$((passed + 1))
		echo "  PASS: $name"
	else
		echo "  FAIL: $name" >&2
	fi
}

keeps_unstaged_hunks() {
	repo
	lines A b c d e f g H >file.ts
	stage_all_but_last_hunk file.ts
	git commit --quiet -m staged
	[ "$(git show HEAD:file.ts)" = "$(lines A b c d e f g h)" ]
	[ "$(git diff --cached --name-only)" = "" ]
	[ "$(cat file.ts)" = "$(lines A b c d e f g H)" ]
}

fixes_fully_staged_files() {
	repo
	lines '// note' a 'b  ' c d e f g h >file.ts
	git add file.ts
	git commit --quiet -m full
	[ "$(git show HEAD:file.ts)" = "$(lines a b c d e f g h)" ]
	[ -z "$(git status --porcelain)" ]
}

fixes_the_staged_hunks_of_a_partly_staged_file() {
	repo
	lines '// note' a 'b  ' c d e f g H >file.ts
	stage_all_but_last_hunk file.ts
	git commit --quiet -m partial
	[ "$(git show HEAD:file.ts)" = "$(lines a b c d e f g h)" ]
	[ "$(cat file.ts)" = "$(lines a b c d e f g H)" ]
	[ "$(git diff --cached --name-only)" = "" ]
}

strips_a_staged_comment_an_unstaged_hunk_removes() {
	repo
	lines a b c d e f g '// note' >file.ts
	git add file.ts
	lines a b c d e f g h >file.ts
	git commit --quiet -m hidden 2>"$work/stderr"
	[ "$(git show HEAD:file.ts)" = "$(lines a b c d e f g)" ]
	[ "$(cat file.ts)" = "$(lines a b c d e f g h)" ]
	grep -q 'file.ts' "$work/stderr"
}

keeps_the_working_tree_when_the_fix_clashes() {
	repo
	lines a b c 'd  ' e f g h >file.ts
	git add file.ts
	lines a b c 'D  ' e f g h >file.ts
	git commit --quiet -m clash 2>"$work/stderr"
	[ "$(git show HEAD:file.ts)" = "$(lines a b c d e f g h)" ]
	[ "$(cat file.ts)" = "$(lines a b c 'D  ' e f g h)" ]
	grep -q 'file.ts' "$work/stderr"
}

takes_paths_literally() {
	repo
	lines a >i.ts
	lines '// note' a >'[id] x.ts'
	git add i.ts '[id] x.ts'
	git commit --quiet -m literal
	[ "$(git show 'HEAD:[id] x.ts')" = a ]
	[ "$(git show HEAD:i.ts)" = a ]
	[ -z "$(git status --porcelain)" ]
}

echo "running pre-commit hook tests..."
run "a commit leaves the unstaged hunks of a file unstaged" keeps_unstaged_hunks
run "the fixers fix a fully staged file in the commit and on disk" fixes_fully_staged_files
run "the fixers fix the staged hunks of a partly staged file" fixes_the_staged_hunks_of_a_partly_staged_file
run "a staged comment that an unstaged hunk removes is still stripped" strips_a_staged_comment_an_unstaged_hunk_removes
run "a fix that clashes with an unstaged hunk lands in the commit only" keeps_the_working_tree_when_the_fix_clashes
run "a path with glob characters and a space is taken literally" takes_paths_literally

echo "$passed/$total tests passed"
[ "$passed" -eq "$total" ]
