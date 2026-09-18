# AGENTS.md

This file provides guidance to coding agents when working with code in this
repository. `CLAUDE.md` is a symlink to it, so Claude Code reads the same file.

It holds what is true repo-wide. **Every workspace carries an `AGENTS.md` of its
own**, with its shape and the rules that govern it. Read that one before working
in a package, and put a rule that belongs to one package there, not here.

## The code is the only source of truth

These files hold rules: how things are interfaced, which way dependencies run,
where a thing belongs. They hold no implementation. Names of types, functions,
files, hook points and ports are read in the code, never here, because prose
rots and the code does not.

So do not add an explanation of how something works, and do not open another
prose file for it either. No design notes, no architecture page, no `devdocs/`
or `docs/` directory, no `NOTES.md`. There is nowhere to move a reason to.

A constraint worth keeping is kept in code: a name that states it, a type that
makes the wrong thing unrepresentable, a test that fails when it is broken. A
number that was measured belongs in the test that asserts it. An invariant
belongs in an assertion. If the reason cannot survive in the code, the code is
what to change.

The only prose that stays is what is written for someone who is not reading the
code: `README`, a package's own `README.md`, and the `AGENTS.md` files. Two
guards back the rule: a `PreToolUse` hook in `.claude/settings.json` refuses to
create a new markdown file, and `pnpm check:docs` fails CI on any tracked
markdown outside that allowlist.

## The IO goes out to an agent

Work that reads, runs or watches is delegated. `.claude/agents/` holds three
agents for it. Each runs a small model, each holds only the tools its job needs,
and each reports the answer instead of the output. What they read costs you
nothing but what they say.

- `explore` — reads the code. What something does, where it lives, what calls
  it, whether it already exists. It answers with the code quoted under
  `file:line` anchors, and it can write nothing.
- `script` — runs the verbose thing. A test run, a typecheck, a build, a
  container log, a throwaway probe against a running service. It reads the
  output and reports the failures verbatim, so the log never lands here.
- `browser` — drives Chrome through `chrome-agent`. A UI bug to reproduce, a
  console error to catch, a request to watch, a screenshot to take.

Send one before you do the work yourself, with the question and the scope.
Independent questions go out as several agents in one message. Claude's built-in
`Explore` is denied in `.claude/settings.json`, so the three above are the only
ones there are.

Keep for yourself the file you are about to edit, the edit, and the short
command whose whole output you actually want. Anything long, wide or repeated is
theirs.

`.claude/hooks/io-budget.sh` holds you to it. It counts the heavy shapes the
main thread runs, a repo-wide `Grep` or `Glob`, a recursive search, a test or
build or log tail, a browser session, and once the budget is spent it refuses
the next one and names the agent that should have had it. The refusal reaches
you, never the user, so take it and spawn the agent instead of retrying. An
agent's own calls are never counted and never refused.

## What this is

A Lisp interpreter designed to be the deterministic "brain" of an AI agent in a
neuro-symbolic architecture. The LLM writes Lisp code into a REPL, and the REPL's
state and output steer the LLM's context back (see `README`).

It is a **Turborepo** pnpm monorepo (`pnpm-workspace.yaml` + `turbo.json`),
workspaces `packages/*` and `apps/*`. Each one's `AGENTS.md` is the entry point
for working in it.

### Packages

- `packages/interpreter` (`@repo/interpreter`) — the language, and the extensions that ship with it. Owns the host-port and seam patterns.
- `packages/mcp` (`@repo/mcp`) — the MCP extension.
- `packages/llm` (`@repo/llm`) — the language-model extension.
- `packages/repl` (`@repo/repl`) — REPL front-ends over the interpreter.
- `packages/ai` (`@repo/ai`) — the agent loop and what it runs on.
- `packages/checks` (`@repo/checks`) — the check extension: the DSL an eval case is written in.
- `packages/evals` (`@repo/evals`) — the eval suite around `@repo/checks`, and all of its reporting.
- `packages/shared` (`@repo/shared`) — the no-dependency utility layer.
- `packages/syntax` (`@repo/syntax`) — the lisptc language for the highlighter.
- `packages/env` (`@repo/env`) — typed env. The only place `process.env` is read.
- `packages/backend` (`@repo/backend`) — the Convex deployment, and the auth instance whose database is Convex itself.
- `packages/ui` (`@repo/ui`) — the base design system.
- `packages/components` (`@repo/components`) — the components we wrote, on top of `@repo/ui`.
- `packages/bloub` (`@repo/bloub`) — the avatar component and its engine. Carries the repo's only carve-outs.
- `packages/tsconfigs` — shared tsconfig bases.

### Apps

- `apps/api` (`api`) — an HTTP server streaming the agent loop.
- `apps/app` (`app`) — the web frontend.
- `apps/cli` (`@lisptc/cli`) — the interactive terminal REPL.
- `apps/lsp` (`@lisptc/lsp`) — a language server for the lisptc dialect.
- `apps/mcp` (`@lisptc/mcp-repl`) — an MCP server exposing the REPL to an MCP client.
- `apps/mcp-toolkit` (`@lisptc/mcp-toolkit`) — the MCP servers we write ourselves, pointing outward.
- `apps/trace-viewer` (`@lisptc/trace-viewer`) — a viewer for eval runs, and the home of the eval cases.

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
  above it reaches past the entrypoints its `package.json` exports. Its stores
  satisfy the language's ports, so it names the language; the language never
  names it.
- A package that runs an eval suite is imported only where the cases live. What
  reads finished runs imports the reading entrypoints instead.

That layering is declared, not described. Each package carries a `turbo.json`
naming its tag, and `boundaries.tags` in the root `turbo.json` says which tags a
tag may not depend on. `pnpm boundaries` fails on a wrong-direction dependency,
on an import of a package missing from a `package.json`, on an import that
reaches into another package's files, and on a cycle. `scripts/check-arch.ts`
(`pnpm check:arch`) holds the rules a manifest cannot express, including the two
below. Every failure prints the way out. Take it. Do not widen a list to get
past one.

## Host ports

An extension owns a language surface and a prompt. **Everything it does that
reaches the world outside the process — the filesystem, the environment, the
network, a subprocess, the clock, its own prompt — goes through an interface the
extension itself declares.** No extension decides where a server runs, where a
token is written, or which model answers; it declares what it needs and is
handed one.

`check:arch` enforces it and names the `-host.ts` to move an offending import
to. **Adding an extension, or a new outward reach in one, means adding a port.**
Do not import `node:fs` "just for this one path".

The shape of the pattern, the rule about ports that may have to wait, and where
a shared port lives are in `packages/interpreter/AGENTS.md`.

## The session seam

Host ports keep an extension from reaching the world. The seam keeps the world
from reaching into an extension.

**Nothing above an extension names it.** Not the REPL, not the agent loop, not
the HTTP layer, not the browser. An extension declares what it does at each
point of a step and what it hands over. Everything above runs it and carries its
bytes without knowing which extension produced them, or that it exists.

Three kinds of thing cross the seam, and each has exactly one mechanism. Reach
for the matching one, never for an import: behaviour goes through a chain, a
capability goes through a slot, data goes through an annotation. Needing
something new is never a reason to import across the seam.

`check:arch` holds it in three rules: a function that takes an extension and
digs a field out of it fails everywhere by shape; the files allowed to run the
lifecycle are listed, and the list only shrinks; `packages/ai/src` may import no
extension module at all, type imports included.

This is the part that rots first. A single type import from a layer above is all
it takes to lose it. The mechanisms and how to add to them are in
`packages/interpreter/AGENTS.md`.

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
naming the reason. An extension never reads a module here at all: it declares a
port and is handed the value.

The Convex deployment carries an environment of its own, and nothing in this
repo pushes it. `packages/backend/AGENTS.md` has the rule.

The Convex deployment carries an environment of its own, and nothing in this
repo pushes it. A deployment secret is stored in Infisical under `/auth` and set
on the deployment by hand, from the dashboard, never written to a file. An OAuth
app's callback points at the web app's origin, where the auth router is served,
not at the deployment.

## Icons

**Every icon comes from hugeicons**: `@hugeicons/core-free-icons` holds the icon
data and `@hugeicons/react` draws it. An icon is data, not a component, so it is
passed as the `icon` prop rather than rendered, and every SVG attribute goes on
the drawing component.

**Do not add `lucide-react`**, or any other icon package. `pnpm check:arch`
fails on an import of it.

## Testing

Tests live in each package's `test/` directory and run under vitest through
Turbo. `packages/bloub` and `packages/components` keep theirs beside the source
instead; their own `AGENTS.md` says so.

A package with shared test helpers has them in `test/helpers.ts`, and a test
should use them rather than assembling the world by hand.

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

task up                      # build and run the whole stack in docker, with live reload

# Single test file / by name — run inside the package that owns it:
pnpm --filter @repo/interpreter exec vitest run test/macros.test.ts
pnpm --filter @repo/interpreter exec vitest run -t "name of test"
```

Every `task` runs under Infisical: `/db` holds the postgres credentials and the
database name, `/convex` the deployment's secret and its origins, `/auth`
everything Better Auth signs and calls out with, the deployment's admin key
included, so the convex CLI is credentialed wherever that environment reaches.

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
