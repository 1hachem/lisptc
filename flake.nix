{
  inputs = {
    nixpkgs.url = "github:nixos/nixpkgs/nixos-25.11";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = {
    nixpkgs,
    flake-utils,
    ...
  }:
    flake-utils.lib.eachDefaultSystem (system: let
      pkgs = nixpkgs.legacyPackages.${system};

      # Shared topiary grammar/config — hermetic, independent of the working
      # tree, so it never rebuilds on source edits.
      topiaryConfig = pkgs.callPackage ./nix/topiary-config.nix {};

      # Hermetic packages, for `nix run .#…`, CI, and distribution. `src` is
      # scoped so unrelated working-tree edits don't rebuild them: ptcfmt only
      # needs its query file; ptcrepl needs the repo root for the workspace.
      ptcfmt = pkgs.callPackage ./nix/ptcfmt.nix {
        src = ./.topiary/queries/commonlisp.scm;
      };
      ptcrepl = pkgs.callPackage ./nix/ptcrepl.nix {
        src = ./.;
        pnpm = pkgs.pnpm_10;
      };

      # Dev-shell tools: run straight from the working tree. No rebuilds on
      # source edits, and they reflect live changes — the whole point of the
      # dev shell, unlike the packaged artifacts above.
      ptcrepl-dev = pkgs.writeShellScriptBin "ptcrepl" ''
        root=$(${pkgs.git}/bin/git rev-parse --show-toplevel)
        exec ${pkgs.nodejs}/bin/node --no-warnings --experimental-transform-types \
          "$root/packages/interpreter/src/lisp.ts" "$@"
      '';
      ptcfmt-dev = pkgs.writeShellScriptBin "ptcfmt" ''
        root=$(${pkgs.git}/bin/git rev-parse --show-toplevel)
        export TOPIARY_CONFIG_FILE=${topiaryConfig.languagesNcl}
        export TOPIARY_LANGUAGE_DIR="$root/.topiary/queries"
        if [ "$#" -eq 0 ]; then
          exec ${pkgs.topiary}/bin/topiary format --language commonlisp
        fi
        exec ${pkgs.topiary}/bin/topiary format "$@"
      '';
    in {
      packages.ptcfmt = ptcfmt;
      packages.ptcrepl = ptcrepl;

      checks.ptcfmt = pkgs.callPackage ./nix/tests/ptcfmt-check.nix {
        src = ./.;
        inherit ptcfmt;
      };

      apps.ptcfmt =
        flake-utils.lib.mkApp {drv = ptcfmt;}
        // {meta.description = "Topiary-based formatter for Lisptc (.ptc) source files";};
      apps.ptcrepl =
        flake-utils.lib.mkApp {drv = ptcrepl;}
        // {meta.description = "Lisptc interpreter REPL";};

      devShells.default = pkgs.mkShell {
        packages = with pkgs; [
          pnpm
          nodejs
          go-task
          infisical
          git
          ptcrepl-dev
          ptcfmt-dev
        ];
      };
    });
}
