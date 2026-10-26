# @repo/tree-sitter

The tree-sitter grammar for lisptc. `ptcfmt` formats `.ptc` files against it.

Turbo tag: `static`.

## Shape

`grammar.js` is the grammar and `tree-sitter.json` is its tree-sitter config.
`flake.nix` hands this directory to `nix/topiary-config.nix`, which runs
`tree-sitter generate` at build time. The generated `src/` is never committed.
The topiary formatting queries live in `.topiary/queries/lisptc.scm` at the
repository root.

## Rules

This package is data. **A `static` package depends on a `foundation` package
at most.** It has no scripts, and `pnpm` builds and tests nothing here. It
answers to `task test:nix`, so a change to the grammar is not done until that
passes.

**The grammar mirrors the reader in `packages/interpreter`.** A change to what
the reader accepts is a change here too.

**Nix reads only what git tracks.** Stage a new file before a nix build can see
it.
