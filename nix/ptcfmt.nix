# ptcfmt: a Topiary-based formatter for Lisptc (.ptc) source files.
#
# Built hermetically — the Common-Lisp tree-sitter grammar is compiled by nix
# and the formatting queries are copied into the store, so ptcfmt never has to
# fetch a git source or compile a grammar at runtime.
{
  lib,
  writeShellApplication,
  writeText,
  runCommand,
  tree-sitter,
  fetchFromGitHub,
  topiary,
  # Repo root, so we can pull in .topiary/queries without depending on the
  # working tree at run time.
  src,
}: let
  # The Common-Lisp tree-sitter grammar. Pinned to match .topiary/languages.ncl.
  commonlispGrammar = tree-sitter.buildGrammar {
    language = "commonlisp";
    version = "32323509";
    src = fetchFromGitHub {
      owner = "theHamsta";
      repo = "tree-sitter-commonlisp";
      rev = "32323509b3d9fe96607d151c2da2c9009eb13a2f";
      hash = "sha256-cNGxZXoxhnXGo4yhMHDSjF/j43JNXg1ClpqN2xJgLQU=";
    };
  };

  # Topiary config pointing at the nix-built grammar (a `.so`).
  languagesNcl = writeText "languages.ncl" ''
    {
      languages = {
        commonlisp = {
          extensions = ["ptc", "lisp", "cl"],
          grammar.source.path = "${commonlispGrammar}/parser",
        },
      },
    }
  '';

  # The formatting rules, copied into the store.
  queries = runCommand "ptcfmt-queries" {} ''
    mkdir -p "$out"
    cp ${src + "/.topiary/queries/commonlisp.scm"} "$out/commonlisp.scm"
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
        exec topiary format --language commonlisp
      fi
      exec topiary format "$@"
    '';
  }
