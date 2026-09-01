# Shared topiary setup for Lisptc: the nix-built tree-sitter grammar and a
# languages.ncl pointing at it. Both the hermetic `ptcfmt` package and the
# dev-shell `ptcfmt` wrapper consume this. This file is the only place the
# topiary language config lives — topiary can only be pointed at a *compiled*
# parser, so there is no checked-in .ncl a bare `topiary` could use.
{
  writeText,
  tree-sitter,
  # tree-sitter-lisptc/ (grammar.js), not the repo root — so unrelated
  # working-tree edits don't rebuild the grammar.
  grammarSrc,
}: rec {
  # The parser is generated from grammar.js at build time, so the repo carries
  # no generated C.
  lisptcGrammar = tree-sitter.buildGrammar {
    language = "lisptc";
    version = "0.1.0";
    src = grammarSrc;
    generate = true;
  };

  languagesNcl = writeText "languages.ncl" ''
    {
      languages = {
        lisptc = {
          extensions = ["ptc"],
          grammar.source.path = "${lisptcGrammar}/parser",
        },
      },
    }
  '';
}
