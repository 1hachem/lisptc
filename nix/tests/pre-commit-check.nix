{
  runCommand,
  git,
  src,
}:
runCommand "pre-commit-check" {nativeBuildInputs = [git];} ''
  mkdir -p hooks/.husky hooks/.agents/hooks
  cp ${src + "/.husky/pre-commit"} hooks/.husky/pre-commit
  cp ${src + "/.agents/hooks/format-files.sh"} hooks/.agents/hooks/format-files.sh
  chmod +x hooks/.agents/hooks/format-files.sh
  patchShebangs hooks
  bash ${src + "/nix/tests/pre-commit.sh"} hooks
  touch "$out"
''
