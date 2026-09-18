# @repo/tsconfigs

The shared tsconfig bases. Two of them, and every package extends one.

## Shape

`base.json` is the node base: NodeNext modules, strict, no emit, node types.
`react.json` is the browser base: bundler resolution, the DOM libs, the React
JSX transform, no ambient node types.

## Rules

A package extends a base and adds only what is genuinely its own, which is
usually `include` and nothing else. A compiler option that belongs to the whole
repo goes in the base, so it lands everywhere at once.

`.ts` runs directly under Node's type stripping, so there is no build step and
no emitted output to configure. `noEmit` stays on.

`packages/bloub` carries the repo's only tsconfig carve-out. Read
`packages/bloub/AGENTS.md` before copying it anywhere else.
