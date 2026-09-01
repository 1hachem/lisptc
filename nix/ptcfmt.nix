# ptcfmt: a Topiary-based formatter for Lisptc (.ptc) source files.
#
# Built hermetically — the tree-sitter grammar is compiled by nix and the
# formatting queries are copied into the store, so ptcfmt never has to fetch a
# git source or compile a grammar at runtime.
{
  writeShellApplication,
  runCommand,
  topiary,
  # nix/topiary-config.nix's languagesNcl, which carries the built grammar.
  languagesNcl,
  # Just the query file (.topiary/queries/lisptc.scm), not the repo root — so
  # unrelated working-tree edits (Taskfile, README, …) don't rebuild ptcfmt.
  src,
}: let
  # The formatting rules, copied into the store.
  queries = runCommand "ptcfmt-queries" {} ''
    mkdir -p "$out"
    cp ${src} "$out/lisptc.scm"
  '';
in
  writeShellApplication {
    name = "ptcfmt";
    runtimeInputs = [topiary];
    text = ''
      export TOPIARY_CONFIG_FILE=${languagesNcl}
      export TOPIARY_LANGUAGE_DIR=${queries}

      # With file arguments, format them in place (extension -> language is
      # resolved from the config). With none, act as a stdin filter.
      if [ "$#" -eq 0 ]; then
        exec topiary format --language lisptc
      fi
      exec topiary format "$@"
    '';
  }
