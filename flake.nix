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
      # The interpreter REPL, packaged hermetically. pnpm deps are fetched
      # offline from pnpm-lock.yaml; the interpreter runs its .ts sources
      # directly via node's --experimental-transform-types (no build step).
      pnpm = pkgs.pnpm_10;
      ptcrepl = pkgs.stdenv.mkDerivation (finalAttrs: {
        pname = "ptcrepl";
        version = "0.0.0";

        src = ./.;

        nativeBuildInputs = [
          pkgs.nodejs
          pnpm.configHook
          pkgs.makeWrapper
        ];

        pnpmDeps = pnpm.fetchDeps {
          inherit (finalAttrs) pname version src;
          fetcherVersion = 2;
          hash = "sha256-a6hJ75gqVIBpvGOUVW6nIo8BTSoHYQsA9FHBu6iHVj4=";
        };

        # No compile step — just stage the workspace (with its installed
        # node_modules) and wrap node to launch the REPL entrypoint.
        dontBuild = true;

        installPhase = ''
          runHook preInstall

          mkdir -p "$out/libexec/lisptc"
          cp -r . "$out/libexec/lisptc/"

          makeWrapper ${pkgs.nodejs}/bin/node "$out/bin/ptcrepl" \
            --add-flags "--no-warnings --experimental-transform-types" \
            --add-flags "$out/libexec/lisptc/packages/interpreter/src/lisp.ts"

          runHook postInstall
        '';
      });
    in {
      packages.ptcfmt = ptcfmt;
      packages.ptcrepl = ptcrepl;
      packages.default = ptcfmt;

      apps.ptcfmt = flake-utils.lib.mkApp {drv = ptcfmt;};
      apps.ptcrepl = flake-utils.lib.mkApp {drv = ptcrepl;};
      apps.default = self.apps.${system}.ptcfmt;

      devShells.default = pkgs.mkShell {
        packages = with pkgs; [
          pnpm
          nodejs
          go-task
          ptcfmt
          ptcrepl
        ];

        shellHook = ''
        '';
      };
    });
}
