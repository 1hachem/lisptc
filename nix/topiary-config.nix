# Shared topiary setup for Lisptc: the nix-built Common-Lisp tree-sitter grammar
# and a languages.ncl pointing at it. Both the hermetic `ptcfmt` package and the
# dev-shell `ptcfmt` wrapper consume this — the grammar is fully hermetic
# (pinned fetchFromGitHub, independent of the working tree), so it never
# rebuilds on source edits.
{
  writeText,
  tree-sitter,
  fetchFromGitHub,
}: rec {
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
}
