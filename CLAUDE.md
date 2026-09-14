# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A Lisp interpreter designed to be the deterministic "brain" of an AI agent in a
neuro-symbolic architecture. The LLM writes Lisp code into a REPL, and the REPL's
state and output steer the LLM's context back (see `README`).

It is a **Turborepo** pnpm monorepo (`pnpm-workspace.yaml` + `turbo.json`),
workspaces `packages/*` and `apps/*`.

### Packages

- `packages/interpreter` (`@repo/interpreter`) — the language itself: reader, evaluator, prelude, and the extensions that ship with it.
- `packages/mcp` (`@repo/mcp`) — the MCP extension, its client and its OAuth. Carries `@modelcontextprotocol/sdk`, so the interpreter does not.
- `packages/llm` (`@repo/llm`) — the language-model extension. Carries `@langchain/openai`, so the interpreter does not.
- `packages/repl` (`@repo/repl`) — REPL front-ends over the interpreter: the embeddable REPLs, the interactive CLI, the shared-session server.
- `packages/ai` (`@repo/ai`) — the agent loop, its system prompt, the model providers, telemetry.
- `packages/checks` (`@repo/checks`) — the check extension: the check DSL an eval case is written in, the report schema it grades into, and the trace and mocked MCP surfaces it reads a run through. Depends on the interpreter and `@repo/mcp`, and on nothing that runs a suite.
- `packages/evals` (`@repo/evals`) — the eval suite around `@repo/checks`: runner, harness, judge, storage, shards, targets, review. It holds no cases of its own.
- `packages/shared` (`@repo/shared`) — the no-dependency utility layer, for what two packages both need and neither owns.
- `packages/syntax` (`@repo/syntax`) — the lisptc language for `@tanstack/highlight`, tokenized with the reader's own `tokenPattern()`. What the chat highlights lisp with, and where `openForms` counts the parens the editor is still waiting on.
- `packages/env` (`@repo/env`) — typed env via t3-env/zod. The only place `process.env` is read.
- `packages/ui` (`@repo/ui`) — the base design system: palette, Tailwind entry, shadcn and ai-elements primitives. Depends on no other workspace package.
- `packages/components` (`@repo/components`) — the components we wrote, on top of `@repo/ui`. Both front-ends import them.
- `packages/bloub` (`@repo/bloub`) — the avatar component (`src/BloubBot.tsx`) and the engine it draws (`src/bot/`, whose `profiles.ts` is generated). It ships raw `.ts`/`.tsx` with no path aliases, its tests sit beside the source instead of in `test/`, and `biome.json` and its own `tsconfig.json` carry the repo's only rule carve-outs for it.
- `packages/tsconfigs` — shared tsconfig bases.

### Apps

- `apps/api` (`api`) — a Hono HTTP server streaming the agent loop over SSE.
- `apps/app` (`app`) — the React/Vite web frontend.
- `apps/lsp` (`@lisptc/lsp`) — a stdio language server for the lisptc dialect.
- `apps/mcp` (`@lisptc/mcp-repl`) — a stdio MCP server exposing the REPL to an MCP client.
- `apps/mcp-toolkit` (`@lisptc/mcp-toolkit`) — the MCP servers we write ourselves, pointing outward.
- `apps/trace-viewer` (`@lisptc/trace-viewer`) — a Next.js viewer for eval runs, and the home of the eval cases (`evals/*.eval.ts`).

Dependencies run one way: the interpreter depends on no workspace package that
depends on it, the extension packages depend on the interpreter, the REPL
front-ends depend on those, and the agent depends on the REPL.

That layering is declared, not described. Each package carries a `turbo.json`
naming its tag, and `boundaries.tags` in the root `turbo.json` says which tags a
tag may not depend on. `pnpm boundaries` fails on a wrong-direction dependency,
on an import of a package missing from a `package.json`, on an import that
reaches into another package's files, and on a cycle.

Two rules sit outside that, in `scripts/check-arch.ts` (`pnpm check:arch`):
`@repo/shared` carries no dependencies at all, and `@repo/ui` carries no
workspace package. Tags cannot express either, because the root package's
`@repo/env` devDependency puts `@repo/env` and `@repo/shared` in every
package's turbo dependency graph. The same file keeps
`@modelcontextprotocol/sdk` and `@langchain/openai` out of the interpreter.

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

# Single test file / by name — run inside the package that owns it:
pnpm --filter @repo/interpreter exec vitest run test/macros.test.ts
pnpm --filter @repo/interpreter exec vitest run -t "name of test"
```

Runtime requires **Node >= 22.6.0**; `.ts` files are executed directly via
`--experimental-transform-types` (no build step). CI (`.github/workflows/ci.yml`)
runs, in order: typecheck → lint → check:comments → check:docs →
boundaries → check:arch → knip → test.
`lint`, the `check:*` scripts and `knip` run once at the root;
`typecheck` and `test` fan out through Turbo. Husky runs commitlint
(conventional commits) on `commit-msg`, and `pnpm check:comments`,
`pnpm boundaries` and `pnpm check:arch` on `pre-push`.

## Comments

**The code carries no comments**, enforced twice: a husky `pre-push` hook, and
`check:comments` in CI as the backstop. The only ones allowed are directives a
tool reads — `biome-ignore`, `/// <reference>`, `// @vitest-environment`,
`// @ts-expect-error` — and those are not prose.

So: **do not write explanatory comments.** Not a header block, not a JSDoc on an
exported function, not a `// why` above a tricky line. The types say what a thing
is; the name says what it does; if neither is enough, the code is what to fix
first.

`pnpm check:comments` lists offenders; `pnpm fix:comments` strips them (then run
`pnpm format`).

## No dev docs

**The code is the only source of truth.** Do not write design notes, architecture
pages, a `devdocs/` or `docs/` directory, a `NOTES.md`, or any other prose file
that explains how something works — and do not answer the urge to comment by
opening a markdown file instead. There is nowhere to move a reason to.

A constraint worth keeping is kept in code: a name that states it, a type that
makes the wrong thing unrepresentable, a test that fails when it is broken. A
number that was measured belongs in the test that asserts it. An invariant
belongs in an assertion. If the reason cannot survive in the code, the code is
what to change.

This holds for every package. The only prose that stays is what is written for
someone who is not reading the code: `README`, a package's own `README.md`, and
this file. Two guards back the rule: a `PreToolUse` hook in
`.claude/settings.json` refuses to create a new markdown file, and
`pnpm check:docs` fails CI on any tracked markdown outside that allowlist.

## Environment variables

**Never read `process.env` directly.** Every variable the code reads is declared
and validated in `packages/env` (`@repo/env`, t3-env + zod), and the rest of the
repo reads the typed value off the module for its area — `@repo/env/api`,
`@repo/env/ai`, `@repo/env/providers`, `@repo/env/evals`, one module per MCP
server under `@repo/env/mcps/*`, and so on. Adding a variable means adding it to
the right module first, so a bad value fails at the boundary instead of halfway
through a request.

`biome`'s `style/noProcessEnv` enforces this; `packages/env/src` and the test
directories are the only paths where the rule is off. Every exemption in `src`
carries a `biome-ignore` naming the reason.

## Testing

Tests live in each package's `test/` directory and run under vitest through
Turbo; `packages/bloub` is the exception, keeping its tests beside the source in
`src/`. `packages/interpreter/test/helpers.ts` holds the shared helpers —
`freshInterp()`, `ev()`, `evAsync()`, `evWithOutput()` — and a test should use
them rather than assembling an interpreter by hand.

The agent evals are separate: the cases live in `apps/trace-viewer/evals` as
`*.eval.ts`, they run against real models, and `pnpm test` does not include them.
`pnpm test:evals` runs them.

## Writing Style

When writing any prose, documentation or commit message:

- Do not use "It's not that X, it's that Y" constructions. Rewrite as a direct statement.
- Do not open responses with affirmations ("Certainly!", "Of course!", "Absolutely!").
- Do not use "It's worth noting", "it's important to mention", or similar throat-clearing.
- Do not narrate your process ("Let me walk you through..."). Just do the thing.
- Prefer active voice over passive voice.
- Prefer short sentences. Break compound thoughts into separate sentences.
- No em dashes. Use a comma, colon, or separate sentence instead.
