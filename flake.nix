{
  inputs = {
    nixpkgs.url = "github:nixos/nixpkgs/nixos-25.11";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = {
    self,
    nixpkgs,
    flake-utils,
    ...
  }:
    flake-utils.lib.eachDefaultSystem (system: let
      pkgs = nixpkgs.legacyPackages.${system};

      # The Common-Lisp tree-sitter grammar, built by nix so ptcfmt never has
      # to fetch/compile it at runtime. Pinned to match .topiary/languages.ncl.
      commonlispGrammar = pkgs.tree-sitter.buildGrammar {
        language = "commonlisp";
        version = "32323509";
        src = pkgs.fetchFromGitHub {
          owner = "theHamsta";
          repo = "tree-sitter-commonlisp";
          rev = "32323509b3d9fe96607d151c2da2c9009eb13a2f";
          hash = "sha256-cNGxZXoxhnXGo4yhMHDSjF/j43JNXg1ClpqN2xJgLQU=";
        };
      };

      # Topiary config pointing at the nix-built grammar (a `.so`), so the whole
      # thing is hermetic — no git source, no runtime compilation.
      languagesNcl = pkgs.writeText "languages.ncl" ''
        {
          languages = {
            commonlisp = {
              extensions = ["ptc", "lisp", "cl"],
              grammar.source.path = "${commonlispGrammar}/parser",
            },
          },
        }
      '';

      # The formatting rules, copied into the store so the package is
      # self-contained and doesn't depend on the working tree.
      queries = pkgs.runCommand "ptcfmt-queries" {} ''
        mkdir -p "$out"
        cp ${./.topiary/queries/commonlisp.scm} "$out/commonlisp.scm"
      '';

      # ptcfmt: a Topiary-based formatter for Lisptc (.ptc) source files.
      ptcfmt = pkgs.writeShellApplication {
        name = "ptcfmt";
        runtimeInputs = [pkgs.topiary];
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
      };
    in {
      packages.ptcfmt = ptcfmt;
      packages.default = ptcfmt;

      apps.ptcfmt = flake-utils.lib.mkApp {drv = ptcfmt;};
      apps.default = self.apps.${system}.ptcfmt;

      devShells.default = pkgs.mkShell {
        packages = with pkgs; [
          pnpm
          nodejs
          go-task
          ptcfmt
        ];

        shellHook = ''
        '';
      };
    });
}
