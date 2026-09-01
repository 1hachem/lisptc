# Test suite for ptcfmt, run as a nix flake check.
#
# Each test asserts something about the formatter's behaviour and prints a
# PASS/FAIL line; the run ends with an "N/N tests passed" summary and fails the
# build if any test failed.
#
# The fixture pair (sample.ptc -> sample.expected.ptc) lives alongside this
# file. The expected output was generated with ptcfmt itself; regenerate it
# with `nix run .#ptcfmt < nix/tests/sample.ptc` if the queries change on
# purpose.
{
  runCommand,
  ptcfmt,
  src,
}:
runCommand "ptcfmt-check" {nativeBuildInputs = [ptcfmt];} ''
  input=${src + "/nix/tests/sample.ptc"}
  expected=${src + "/nix/tests/sample.expected.ptc"}

  total=0
  passed=0

  # run <name> <cmd...>: succeeds if the command exits 0.
  run() {
    local name="$1"; shift
    total=$((total + 1))
    if "$@"; then
      passed=$((passed + 1))
      echo "  PASS: $name"
    else
      echo "  FAIL: $name" >&2
    fi
  }

  echo "running ptcfmt tests..."

  # 1. Formatting the sample produces the expected, checked-in output.
  run "sample.ptc formats to sample.expected.ptc" \
    bash -c 'diff -u "$0" <(ptcfmt < "$1")' "$expected" "$input"

  # 2. Formatting is idempotent: re-formatting formatted output is a no-op.
  run "formatting is idempotent" \
    bash -c 'diff -u "$0" <(ptcfmt < "$0")' "$expected"

  # 3. ptcfmt collapses runs of whitespace inside a form.
  run "collapses redundant whitespace" \
    bash -c '[ "$(printf "(a   b)\n" | ptcfmt)" = "(a b)" ]'

  # 4. Prose around the forms is nobody's to reformat: a prose-only file is
  #    already a fixed point, punctuation and all. Regression test for the
  #    Common-Lisp grammar this formatter used to borrow, which read a "," as
  #    an unquote, a ";" as a comment, and every word as its own top-level
  #    form to put on its own line.
  run "leaves prose untouched" \
    bash -c 'diff -u "$0" <(ptcfmt < "$0")' ${src + "/nix/tests/prose.ptc"}

  echo "$passed/$total tests passed"
  if [ "$passed" -ne "$total" ]; then
    echo "ptcfmt tests failed" >&2
    echo "regenerate the expected fixture with: nix run .#ptcfmt < nix/tests/sample.ptc" >&2
    exit 1
  fi

  touch "$out"
''
