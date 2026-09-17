# AGENTS.md

This file provides guidance to coding agents when working with code in this
repository. `CLAUDE.md` is a symlink to it, so Claude Code reads the same file.

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
- `packages/checks` (`@repo/checks`) — the check extension: the check DSL an eval case is written in, the verdict it settles on, and the trace and mocked MCP surfaces it reads a run through. Core logic and language features only, so it carries no reporting and depends on nothing that runs a suite.
- `packages/evals` (`@repo/evals`) — the eval suite around `@repo/checks`, and all of its reporting: runner, harness, judge, report schema, storage, shards, targets, review. It holds no cases of its own.
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

`check:arch` also reads imports, for the rule a manifest cannot hold: the
entrypoints that run a suite — `@repo/evals/runner`, `/harness`, `/judge`,
`/targets`, `/global-setup` — may only be imported under
`apps/trace-viewer/evals`, the directory that holds the cases. The viewer reads
finished runs through `/report`, `/review` and `/storage` instead, so a Next.js
page never pulls in vitest or a model provider. `apps/trace-viewer` declares
`@repo/evals` once, which is why the rule has to be about imports.

Three more rules in the same file keep the layers above an extension from
naming it. They are the enforcement half of **The session seam** below, which
is where to read before changing anything that crosses it.

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

A commit is its title. `body-max-lines` in `.commitlintrc.ts` rejects a body
longer than one line, so write the subject and stop unless a description was
asked for, and then keep it to a single line after the blank one. Trailers
like `Co-Authored-By` are footers and do not count.

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
this file (plus the `CLAUDE.md` symlink pointing at it). Two guards back the
rule: a `PreToolUse` hook in `.claude/settings.json` refuses to create a new
markdown file, and `pnpm check:docs` fails CI on any tracked markdown outside
that allowlist.

## Icons

**Every icon comes from hugeicons.** `@hugeicons/core-free-icons` holds the icon
data and `@hugeicons/react` draws it:

```tsx
import { Search01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

<HugeiconsIcon icon={Search01Icon} className="size-4" />;
```

An icon is data (`IconSvgElement`), not a component, so it is passed as the
`icon` prop rather than rendered. `size`, `strokeWidth` and every SVG attribute
go on `HugeiconsIcon`.

**Do not add `lucide-react`**, or any other icon package. `pnpm check:arch`
fails on an import of it. `shadcn add` still scaffolds lucide imports: swap them
for the hugeicons equivalent before committing.

## Host ports

An extension owns a language surface and a prompt. **Everything it does that
reaches the world outside the process — the filesystem, the environment, the
network, a subprocess, the clock, its own `.ptc` prompt — goes through an
interface the extension itself declares.** No extension decides where a server
runs, where a token is written, or which model answers; it declares what it
needs and is handed one.

The shape is the same everywhere:

- `<name>.ts` is the extension. It declares `<Name>Host`, one field per port,
  and takes it as its first argument. It imports no `node:` builtin, no
  `@repo/env` module, no vendor SDK, and never reads `process.env`. What it
  cannot reach, it cannot hard-code.
- `<name>-host.ts` sits beside it and holds the implementations, plus a
  `<name>Host` value wiring the default strategy. This is the only file in the
  pair that touches the world.
- The default arrives as a **default argument** — `proseExtension(host =
  proseHost)` — so the common call stays `proseExtension()` and any other
  strategy is one spread away: `mcpExtension({ ...mcpHost, client })`.
- A host field whose value is expensive or whose class lives in the extension
  module is a getter, because the two files import each other and a class is
  not hoisted.

`pnpm check:arch` enforces the first bullet: an extension module that imports a
node builtin, a typed env module, an SDK or `dotenv`, or that reads
`process.env`, fails CI and is told which `-host.ts` to move it to. Type-only
imports are allowed, so a port may still be typed in the SDK's own terms.

The ports that exist today: `MemoryStore`, `SecretsStore`, `Generate` and
`providers` (llm), `ProseClassifier`, `McpClient`, `McpHost` (where an MCP
server runs — `ensure`/`stop`/`status`/`logs`, so a subprocess and a container
look alike), `ToolkitRegistry` (which servers exist), `OAuthStore` (keyed by
scope, so two people's accounts do not collide), `EnvLookup`, `Clock` and
`PromptSource`. The last four live in `@repo/shared/host`, which two packages
share and neither owns; `@repo/shared/host-node` holds the node-side
`filePrompt`.

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
points it cares about. `SessionHooks` in `@repo/interpreter/session` holds
them, built on the same `Chain` the interpreter already uses for `readSource`,
`skipForm` and `evalForm`:

- `beginTurn` speaks before the model generates, and what it says rides the
  user's own message.
- `evalStep` wraps the evaluation.
- `stepOutput` and `stepError` shape what comes back.
- `answered` decides that a step ended the turn.
- `unrun` names the forms a step did not run.
- `annotate` reports what the step did.
- `invoke` runs a ui action.

`openSession(extensions)` collects them once. A driver runs a chain with a base
case and never asks who is on it. Give every new chain a base that is correct
when nobody hooks it, because a REPL built without that extension will take it.

### A capability goes through a slot

`slot<T>(name)` mints a key. The extension fills it with `hooks.fill`, the
consumer reads it with `hooks.filled`, and neither imports the other's module.
`memorySlot` and `secretsSlot` sit in their extensions. `llmSlot` sits in
`@repo/llm/observe` beside the observer contract it hands over, so watching
model calls does not pull in the extension that makes them.

Never search the extension list for a capability. An exported function taking a
single `InterpExtension` and digging a field out of it fails `check:arch` by
shape, with no allowlist.

### Data goes through an annotation

A step reports what it did in `StepAnnotations`, filled through the `annotate`
chain. Two bags of string keys, split by audience and by nothing else:

- `step` rides the tool result the model reads. A fired memory goes here.
- `output` rides the wire only the browser reads. A rendered view goes here.

The extension picks the key and owns the shape; `annotating(into, lane, entry)`
adds one. Everything above merges without naming a key. `replResultContent`
spreads `step` into the tool-result JSON. `stream.ts` merges `step` into
`meta`, concatenating where two arrays land on one key, and spreads `output`
into `additional_kwargs`.

This is the part that rots first. `FiredMemory` and `UiNode` were once typed
into `EvalOutput`, then into `TurnEvent`, then into the SSE writer, so
`@repo/ai` named an extension's type to move bytes it never read. One type
import is all it takes.

### Adding to it

Needing something new is never a reason to import across the seam.

- A new point in the lifecycle: add a chain to `SessionHooks`.
- A new capability to hand over: mint a slot.
- A new thing to report: pick a key, pick the lane by who reads it, write it in
  `annotate`.
- A payload a layer above would have to interpret: that interpretation belongs
  below the seam. Move it into the extension. `nodeToJson` moved into the ui
  extension for exactly this reason.

### Enforcement

`check:arch` holds three lines.

- The sniffing shape fails everywhere, as above.
- `DRIVERS` names the files that run the lifecycle. They import an extension
  module for types only, and each carries the value imports it has not shed
  yet. The check fails on a name missing from that list and on a name on it the
  file no longer imports, so the list only shrinks.
- `BLIND` names a whole tree, `packages/ai/src`, where no extension module may
  be imported at all, type imports included. Its roster is the exception list:
  `repl-store.ts`, where building the REPL is the job.

Every failure prints the way out. Take it. Do not widen a list to get past one.

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
