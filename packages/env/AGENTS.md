# @repo/env

Typed env. **The only place `process.env` is read.**

Turbo tag: `foundation`.

## Shape

One module per area, each exporting the validated value that area reads:
analytics, api, app, evals, infisical, memory, oauth, providers, r2, repl,
server, trace-viewer, web, and `mcps/` for the toolkit servers. `src/errors.ts`
holds the failure shape they all report through, so a bad value fails the same
way everywhere. `src/index.ts` re-exports the common ones.

## Rules

Adding a variable means adding it to the module for its area first. A variable
the code reads is declared and validated here, so a bad value fails at the
boundary instead of halfway through a request.

The rest of the repo reads the typed value off the module. A lint rule enforces
it, and `src/` here plus the test directories are the only paths where it is
off. Every exemption inside `src/` carries a `biome-ignore` naming its reason.

An extension never imports a module from this package. It declares a port and is
handed the value. `check:arch` fails on `@repo/env/*` inside an extension module
and names the `-host.ts` to move it to.

The Convex deployment carries an environment of its own. Nothing here pushes it
and nothing here reads it.
