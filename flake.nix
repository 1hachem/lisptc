{
  inputs = {
    nixpkgs.url = "github:nixos/nixpkgs/nixos-25.11";
    flake-utils.url = "github:numtide/flake-utils";
    chrome-agent.url = "github:1hachem/chrome-agent";
  };

  outputs = {
    nixpkgs,
    flake-utils,
    chrome-agent,
    ...
  }:
    flake-utils.lib.eachDefaultSystem (system: let
      pkgs = nixpkgs.legacyPackages.${system};

      # Hermetic topiary grammar/config, independent of the working tree.
      topiaryConfig = pkgs.callPackage ./nix/topiary-config.nix {
        grammarSrc = ./tree-sitter-lisptc;
      };

      # Hermetic packages for `nix run .#…`, CI, and distribution; scoped src.
      ptcfmt = pkgs.callPackage ./nix/ptcfmt.nix {
        inherit (topiaryConfig) languagesNcl;
        src = ./.topiary/queries/lisptc.scm;
      };
      ptcrepl = pkgs.callPackage ./nix/ptcrepl.nix {
        src = ./.;
        pnpm = pkgs.pnpm_10;
      };
      r2mount = pkgs.callPackage ./nix/r2mount.nix {};

      # Dev-shell tools: run straight from the working tree, reflecting live edits.
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
          exec ${pkgs.topiary}/bin/topiary format --language lisptc
        fi
        exec ${pkgs.topiary}/bin/topiary format "$@"
      '';
    in {
      packages.ptcfmt = ptcfmt;
      packages.ptcrepl = ptcrepl;
      packages.r2mount = r2mount;

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
      apps.r2mount =
        flake-utils.lib.mkApp {drv = r2mount;}
        // {meta.description = "Mount the project's Cloudflare R2 bucket under the working tree";};

      devShells.default = pkgs.mkShell {
        packages = with pkgs; [
          pnpm
          nodejs
          go-task
          infisical
          git
          # `magick`, for `pnpm --filter app favicon`: the tab icon is generated
          # from the bot engine and rasterised into a .ico. Only that script needs
          # it — the icon is checked in, so no build or test does.
          imagemagick
          ptcrepl-dev
          ptcfmt-dev
          r2mount
          chrome-agent.packages.${system}.default
          playwright-driver.browsers
        ];

        # Use the Nix browsers instead of downloaded ones; skip host-dep validation.
        PLAYWRIGHT_BROWSERS_PATH = "${pkgs.playwright-driver.browsers}";
        PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS = "true";

        shellHook = ''
          export PLAYWRIGHT_MCP_EXECUTABLE="$(echo "$PLAYWRIGHT_BROWSERS_PATH"/chromium-*/chrome-linux/chrome)"
          export CHROME_AGENT_CHROME="$PLAYWRIGHT_MCP_EXECUTABLE"
        '';
      };
    });
}
