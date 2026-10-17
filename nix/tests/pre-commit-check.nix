{
  runCommand,
  git,
  src,
}:
runCommand "pre-commit-check" {nativeBuildInputs = [git];} ''
  mkdir -p hooks/.husky
  cp ${src + "/.husky/pre-commit"} hooks/.husky/pre-commit
  bash ${src + "/nix/tests/pre-commit.sh"} hooks
  touch "$out"
''
