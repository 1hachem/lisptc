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

      # Each package's build lives in its own file under ./nix. `src` (the repo
      # root) is threaded in so the derivations don't depend on the working tree.
      ptcfmt = pkgs.callPackage ./nix/ptcfmt.nix {src = ./.;};
      ptcrepl = pkgs.callPackage ./nix/ptcrepl.nix {
        src = ./.;
        pnpm = pkgs.pnpm_10;
      };
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
          ptcfmt
          ptcrepl
        ];
      };
    });
}
