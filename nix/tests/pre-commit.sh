#!/usr/bin/env bash
set -euo pipefail

src=$(cd "${1:-$(dirname "$0")/../..}" && pwd)
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

mkdir -p "$work/bin"
cat >"$work/bin/pnpm" <<'EOF'
#!/bin/sh
case "$*" in
"exec no-comments --staged --fix")
	git diff --cached --name-only --diff-filter=ACMR -z | xargs -0 -r sed -i '/^\/\//d'
	;;
esac
EOF
chmod +x "$work/bin/pnpm"
export PATH="$work/bin:$PATH"
export GIT_AUTHOR_NAME=test GIT_AUTHOR_EMAIL=test@example.com
export GIT_COMMITTER_NAME=test GIT_COMMITTER_EMAIL=test@example.com
export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1

repo() {
	rm -rf "$work/repo"
	mkdir -p "$work/repo/.husky" "$work/repo/.agents/hooks" "$work/repo/.git-hooks"
	cd "$work/repo"
	git init --quiet
	cp "$src/.husky/pre-commit" .husky/pre-commit
	cp "$src/.agents/hooks/format-files.sh" .agents/hooks/format-files.sh
	printf '#!/bin/sh\nexec sh -e .husky/pre-commit\n' >.git-hooks/pre-commit
	chmod +x .git-hooks/pre-commit .agents/hooks/format-files.sh
	git config core.hooksPath .git-hooks
	printf 'a\nb\nc\nd\ne\nf\ng\nh\n' >file.ts
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
	printf 'A\nb\nc\nd\ne\nf\ng\nH\n' >file.ts
	git diff -U0 file.ts | sed '/^@@ -8 /,$d' | git apply --cached --unidiff-zero
	git commit --quiet -m staged
	[ "$(git show HEAD:file.ts)" = "$(printf 'A\nb\nc\nd\ne\nf\ng\nh')" ]
	[ "$(git diff --name-only)" = file.ts ]
	[ "$(git diff --cached --name-only)" = "" ]
	[ "$(cat file.ts)" = "$(printf 'A\nb\nc\nd\ne\nf\ng\nH')" ]
}

fixes_fully_staged_files() {
	repo
	printf '// note\na\nb\nc\nd\ne\nf\ng\nh\n' >file.ts
	git add file.ts
	git commit --quiet -m full
	[ "$(git show HEAD:file.ts)" = "$(printf 'a\nb\nc\nd\ne\nf\ng\nh')" ]
	git diff --quiet
}

refuses_to_fix_partly_staged_files() {
	repo
	printf '// note\na\nb\nc\nd\ne\nf\ng\nH\n' >file.ts
	cp file.ts "$work/before"
	git diff -U0 file.ts | sed '/^@@ -8 /,$d' | git apply --cached --unidiff-zero
	local index
	index=$(git rev-parse :file.ts)
	if git commit --quiet -m partial 2>/dev/null; then
		return 1
	fi
	[ "$(git log --oneline | wc -l)" -eq 1 ]
	[ "$(git rev-parse :file.ts)" = "$index" ]
	cmp -s file.ts "$work/before"
}

echo "running pre-commit hook tests..."
run "a commit leaves the unstaged hunks of a file unstaged" keeps_unstaged_hunks
run "the fixers still fix and stage a fully staged file" fixes_fully_staged_files
run "a fixer change to a partly staged file fails the commit and changes nothing" refuses_to_fix_partly_staged_files

echo "$passed/$total tests passed"
[ "$passed" -eq "$total" ]
