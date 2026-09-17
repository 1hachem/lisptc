# AGENTS.md

This file provides guidance to coding agents when working with code in this
repository. `CLAUDE.md` is a symlink to it, so Claude Code reads the same file.

## The code is the only source of truth

This file holds rules: how things are interfaced, which way dependencies run,
where a thing belongs. It holds no implementation. Names of types, functions,
files, hook points and ports are read in the code, never here, because prose
rots and the code does not.

So do not add an explanation of how something works to this file, and do not
open another prose file for it either. No design notes, no architecture page,
no `devdocs/` or `docs/` directory, no `NOTES.md`. There is nowhere to move a
reason to.

A constraint worth keeping is kept in code: a name that states it, a type that
makes the wrong thing unrepresentable, a test that fails when it is broken. A
number that was measured belongs in the test that asserts it. An invariant
belongs in an assertion. If the reason cannot survive in the code, the code is
what to change.

The only prose that stays is what is written for someone who is not reading the
code: `README`, a package's own `README.md`, and this file. Two guards back the
rule: a `PreToolUse` hook in `.claude/settings.json` refuses to create a new
markdown file, and `pnpm check:docs` fails CI on any tracked markdown outside
that allowlist.

## What this is

A Lisp interpreter designed to be the deterministic "brain" of an AI agent in a
neuro-symbolic architecture. The LLM writes Lisp code into a REPL, and the REPL's
state and output steer the LLM's context back (see `README`).

It is a **Turborepo** pnpm monorepo (`pnpm-workspace.yaml` + `turbo.json`),
workspaces `packages/*` and `apps/*`.

### Packages

- `packages/interpreter` (`@repo/interpreter`) — the language itself, and the extensions that ship with it.
- `packages/mcp` (`@repo/mcp`) — the MCP extension. Carries the MCP SDK, so the interpreter does not.
- `packages/llm` (`@repo/llm`) — the language-model extension. Carries the model SDK, so the interpreter does not.
- `packages/repl` (`@repo/repl`) — REPL front-ends over the interpreter.
- `packages/ai` (`@repo/ai`) — the agent loop and what it runs on.
- `packages/checks` (`@repo/checks`) — the check extension: the DSL an eval case is written in and the surfaces it reads a run through. Core logic and language features only, so it depends on nothing that runs a suite.
- `packages/evals` (`@repo/evals`) — the eval suite around `@repo/checks`, and all of its reporting. It holds no cases of its own.
- `packages/shared` (`@repo/shared`) — the no-dependency utility layer, for what two packages both need and neither owns.
- `packages/syntax` (`@repo/syntax`) — the lisptc language for the highlighter, tokenized with the reader's own tokens.
- `packages/env` (`@repo/env`) — typed env. The only place `process.env` is read.
- `packages/backend` (`@repo/backend`) — the Convex deployment: the schema every other package reads through, the functions that guard it, and the Better Auth instance whose database is Convex itself. Its source lives in `convex/` instead of `src/`.
- `packages/ui` (`@repo/ui`) — the base design system. Depends on no other workspace package.
- `packages/components` (`@repo/components`) — the components we wrote, on top of `@repo/ui`. Both front-ends import them.
- `packages/bloub` (`@repo/bloub`) — the avatar component and its engine. It ships raw `.ts`/`.tsx` with no path aliases, its tests sit beside the source instead of in `test/`, and it carries the repo's only lint and tsconfig carve-outs.
- `packages/tsconfigs` — shared tsconfig bases.

### Apps

- `apps/api` (`api`) — an HTTP server streaming the agent loop.
- `apps/app` (`app`) — the web frontend.
- `apps/lsp` (`@lisptc/lsp`) — a language server for the lisptc dialect.
- `apps/mcp` (`@lisptc/mcp-repl`) — an MCP server exposing the REPL to an MCP client.
- `apps/mcp-toolkit` (`@lisptc/mcp-toolkit`) — the MCP servers we write ourselves, pointing outward.
- `apps/trace-viewer` (`@lisptc/trace-viewer`) — a viewer for eval runs, and the home of the eval cases (`evals/*.eval.ts`).

## Dependency flow

Dependencies run one way, and only one way:

```
interpreter  →  extensions  →  repl front-ends  →  agent  →  apps
```

- The interpreter depends on no workspace package that depends on it.
- An extension package depends on the interpreter, and carries the SDK its
  surface needs so the interpreter never does.
- A REPL front-end depends on the interpreter and on extensions.
- The agent depends on the REPL, not on any extension.
- `@repo/shared` carries no dependencies at all. `@repo/ui` carries no
  workspace package.
- `@repo/backend` depends on no workspace package that reads it, and nothing
  above it reaches past the entrypoints its `package.json` exports into the
  deployment's files. `apps/app` subscribes to its functions directly and its
  server routes serve the auth router against the deployment's HTTP origin;
  `apps/api` verifies a token against that origin's JWKS instead.
- A package that runs an eval suite is imported only where the cases live. What
  reads finished runs imports the reading entrypoints instead, so a page never
  pulls in a test runner or a model provider.

That layering is declared, not described. Each package carries a `turbo.json`
naming its tag, and `boundaries.tags` in the root `turbo.json` says which tags a
tag may not depend on. `pnpm boundaries` fails on a wrong-direction dependency,
on an import of a package missing from a `package.json`, on an import that
reaches into another package's files, and on a cycle. `scripts/check-arch.ts`
(`pnpm check:arch`) holds the rules a manifest cannot express, including the
ones for **Host ports** and **The session seam** below.

## Host ports

An extension owns a language surface and a prompt. **Everything it does that
reaches the world outside the process — the filesystem, the environment, the
network, a subprocess, the clock, its own prompt — goes through an interface
the extension itself declares.** No extension decides where a server runs,
where a token is written, or which model answers; it declares what it needs and
is handed one.

The shape is the same everywhere:

- `<name>.ts` is the extension. It declares its host interface, one field per
  port, and takes it as its first argument. It imports no `node:` builtin, no
  typed env module, no vendor SDK, and never reads `process.env`. What it
  cannot reach, it cannot hard-code.
- `<name>-host.ts` sits beside it and holds the implementations, plus the
  value wiring the default strategy. This is the only file in the pair that
  touches the world.
- The default arrives as a **default argument**, so the common call passes
  nothing and any other strategy is one spread away.
- A port two packages share and neither owns lives in `@repo/shared/host`; its
  node-side implementation lives in `@repo/shared/host-node`.

`pnpm check:arch` enforces the first bullet and names the `-host.ts` to move
the offending import to. Type-only imports are allowed, so a port may still be
typed in an SDK's own terms.

**Adding an extension, or a new outward reach in one, means adding a port.**
Do not import `node:fs` "just for this one path" — that is the decision the
pattern exists to keep out of the extension.

## The session seam

Host ports keep an extension from reaching the world. The seam keeps the world
from reaching into an extension.

**Nothing above an extension names it.** Not the REPL, not the agent loop, not
the HTTP layer, not the browser. An extension declares what it does at each
point of a step and what it hands over. Everything above runs it and carries
its bytes without knowing which extension produced them, or that it exists.

Three kinds of thing cross the seam, and each has exactly one mechanism. Reach
for the matching one, never for an import.

### Behaviour goes through a chain

An extension declares a `session` field beside its `prompt` and hooks the
points it cares about. The hooks are the ones `SessionHooks` in
`@repo/interpreter/session` declares; read them there. A driver runs a chain
with a base case and never asks who is on it. Give every new chain a base that
is correct when nobody hooks it, because a REPL built without that extension
will take it.

### A capability goes through a slot

A slot mints a key. The extension fills it, the consumer reads it, and neither
imports the other's module. A slot belongs beside the contract it hands over,
which may be a module separate from the extension so that consuming the
capability does not pull in what provides it.

Never search the extension list for a capability. A function taking an
extension and digging a field out of it fails `check:arch` by shape, with no
allowlist.

### Data goes through an annotation

A step reports what it did in annotations: bags of string keys, split by
audience and by nothing else. One lane rides the tool result the model reads,
the other rides the wire only the browser reads. The extension picks the key
and owns the shape. Everything above merges without naming a key.

This is the part that rots first. A single type import from a layer above is
all it takes to lose it.

### Adding to it

Needing something new is never a reason to import across the seam.

- A new point in the lifecycle: add a chain to `SessionHooks`.
- A new capability to hand over: mint a slot.
- A new thing to report: pick a key, pick the lane by who reads it, write it in
  the annotate chain.
- A payload a layer above would have to interpret: that interpretation belongs
  below the seam. Move it into the extension.

### Enforcement

`check:arch` holds the seam in three rules: the capability-sniffing shape fails
everywhere; the files allowed to run the lifecycle are listed, and the list
only shrinks; `packages/ai/src` may import no extension module at all, type
imports included. Every failure prints the way out. Take it. Do not widen a
list to get past one.

## Comments

**The code carries no comments**, enforced twice: a husky `pre-push` hook, and
`check:comments` in CI as the backstop. The only ones allowed are directives a
tool reads, and those are not prose.

So: **do not write explanatory comments.** Not a header block, not a JSDoc on an
exported function, not a `// why` above a tricky line. The types say what a thing
is; the name says what it does; if neither is enough, the code is what to fix
first.

`pnpm check:comments` lists offenders; `pnpm fix:comments` strips them (then run
`pnpm format`).

## Environment variables

**Never read `process.env` directly.** Every variable the code reads is declared
and validated in `packages/env` (`@repo/env`), and the rest of the repo reads
the typed value off the module for its area. Adding a variable means adding it
to the right module first, so a bad value fails at the boundary instead of
halfway through a request.

A lint rule enforces this; `packages/env/src` and the test directories are the
only paths where it is off. Every exemption in `src` carries a `biome-ignore`
naming the reason.

The Convex deployment carries an environment of its own. `@repo/env/convex`
declares every variable pushed onto it and `scripts/convex-deploy.ts` pushes
them, so adding a deployment secret means declaring it there and storing it in
Infisical under `/auth`, never writing it to a file. An OAuth app's callback
points at the web app's origin, where the auth router is served, not at the
deployment.

## Icons

**Every icon comes from hugeicons**: `@hugeicons/core-free-icons` holds the icon
data and `@hugeicons/react` draws it. An icon is data, not a component, so it is
passed as the `icon` prop rather than rendered, and every SVG attribute goes on
the drawing component.

**Do not add `lucide-react`**, or any other icon package. `pnpm check:arch`
fails on an import of it. `shadcn add` still scaffolds lucide imports: swap them
for the hugeicons equivalent before committing.

## Testing

Tests live in each package's `test/` directory and run under vitest through
Turbo; `packages/bloub` is the exception, keeping its tests beside the source in
`src/`. `packages/interpreter/test/helpers.ts` holds the shared helpers, and a
test should use them rather than assembling an interpreter by hand.

The agent evals are separate: the cases live in `apps/trace-viewer/evals` as
`*.eval.ts`, they run against real models, and `pnpm test` does not include them.
`pnpm test:evals` runs them.

## Commands

Root scripts delegate to Turbo, which fans out across workspaces:

```bash
pnpm test                    # turbo run test (vitest run in each package)
pnpm typecheck               # turbo run typecheck (tsc --noEmit per package)
pnpm lint                    # biome ci (lint + format check) — matches CI, run at root
pnpm format                  # biome check --write (auto-fix)
pnpm knip                    # dead-code / unused-dependency check (part of CI), run at root
pnpm boundaries              # package layering + import rules (part of CI), run at root
pnpm check:arch              # manifest rules boundaries cannot express (part of CI)
pnpm check:comments          # fails on any non-directive comment (part of CI), run at root
pnpm fix:comments            # strip them; follow with `pnpm format`
pnpm check:docs              # fails on tracked markdown outside the allowlist (part of CI)
pnpm fix:docs                # delete those files
pnpm test:watch              # turbo run test:watch
pnpm test:evals              # agent evals against real models (NOT part of `pnpm test`)
pnpm repl                    # turbo run repl (run the interpreter REPL directly)

task convex:up               # postgres + convex backend + dashboard, in docker compose
task convex:key              # mint an admin key, push the deployment's env, push the functions

# Single test file / by name — run inside the package that owns it:
pnpm --filter @repo/interpreter exec vitest run test/macros.test.ts
pnpm --filter @repo/interpreter exec vitest run -t "name of test"
```

Every `task` runs under Infisical: `/db` holds the postgres credentials and the
database name, `/convex` the deployment's secret and its origins, `/auth`
everything Better Auth signs and calls out with. `convex:key` writes the local
credentials `@repo/backend` reads and is safe to re-run; `pnpm --filter
@repo/backend dev` then pushes on save and watches.

Runtime requires **Node >= 22.6.0**; `.ts` files are executed directly via
`--experimental-transform-types` (no build step). CI (`.github/workflows/ci.yml`)
runs, in order: typecheck → lint → check:comments → check:docs →
boundaries → check:arch → knip → test.
`lint`, the `check:*` scripts and `knip` run once at the root;
`typecheck` and `test` fan out through Turbo. Husky runs commitlint
(conventional commits) on `commit-msg`, and `pnpm check:comments`,
`pnpm boundaries` and `pnpm check:arch` on `pre-push`.

A commit is its title. `body-max-lines` in `.commitlintrc.ts` rejects a body
longer than one line, so write the subject and stop unless a description was
asked for, and then keep it to a single line after the blank one. Trailers
like `Co-Authored-By` are footers and do not count.

## Writing Style

When writing any prose, documentation or commit message:

- Do not use "It's not that X, it's that Y" constructions. Rewrite as a direct statement.
- Do not open responses with affirmations ("Certainly!", "Of course!", "Absolutely!").
- Do not use "It's worth noting", "it's important to mention", or similar throat-clearing.
- Do not narrate your process ("Let me walk you through..."). Just do the thing.
- Prefer active voice over passive voice.
- Prefer short sentences. Break compound thoughts into separate sentences.
- No em dashes. Use a comma, colon, or separate sentence instead.
