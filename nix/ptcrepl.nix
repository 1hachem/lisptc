# ptcrepl: the interpreter REPL, packaged hermetically.
#
# pnpm deps are fetched offline from pnpm-lock.yaml; the interpreter runs its
# .ts sources directly via node's --experimental-transform-types (no build
# step). Bump `pnpmDeps.hash` whenever pnpm-lock.yaml changes.
{
  stdenv,
  nodejs,
  pnpm,
  makeWrapper,
  # Repo root.
  src,
}:
  stdenv.mkDerivation (finalAttrs: {
    pname = "ptcrepl";
    version = "0.0.0";

    inherit src;

    nativeBuildInputs = [
      nodejs
      pnpm.configHook
      makeWrapper
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

      makeWrapper ${nodejs}/bin/node "$out/bin/ptcrepl" \
        --add-flags "--no-warnings --experimental-transform-types" \
        --add-flags "$out/libexec/lisptc/packages/interpreter/src/lisp.ts"

      runHook postInstall
    '';
  })
