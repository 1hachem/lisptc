# AGENTS.md

This file provides guidance to coding agents when working with code in this
repository.

It holds what is true repo-wide. **Every workspace carries an `AGENTS.md` of its
own**, with its shape and the rules that govern it. Read that one before working
in a package, and put a rule that belongs to one package there, not here.

## The code is the only source of truth

These files hold rules: how things are interfaced, which way dependencies run,
where a thing belongs. They hold no implementation. Names of types, functions,
files, hook points and ports are read in the code, never here, because prose
rots and the code does not.

So do not add an explanation of how something works, and do not open another
prose file for it either. No design notes, no architecture page, no devdocs/
or docs/ directory, no NOTES.md. There is nowhere to move a reason to.

A constraint worth keeping is kept in code: a name that states it, a type that
makes the wrong thing unrepresentable, a test that fails when it is broken. A
number that was measured belongs in the test that asserts it. An invariant
belongs in an assertion. If the reason cannot survive in the code, the code is
what to change.

The only prose that stays is what is written for someone who is not reading the
code: the root `README.md`, a package's own README.md, the `AGENTS.md` files, and what an
agent runner itself reads under `.agents/` and `.github/`.

## The IO goes out to an agent

Work that reads, runs or watches is delegated. Three agents hold it, each on a
small model, each with only the tools its job needs, and each reporting the
answer instead of the output. What they read costs you nothing but what they
say.

- `explore` — reads the code. What something does, where it lives, what calls
  it, whether it already exists. It answers with the code quoted under
  file:line anchors, and it can write nothing.
- `script` — runs the verbose thing. A test run, a typecheck, a build, a
  container log, a throwaway probe against a running service. It reads the
  output and reports the failures verbatim, so the log never lands here.
- `browser` — drives Chrome through `chrome-agent`. A UI bug to reproduce, a
  console error to catch, a request to watch, a screenshot to take.

Send one before you do the work yourself, with the question and the scope.
Independent questions go out as several agents in one message. Claude's built-in
`Explore` is denied in `.claude/settings.json`, so the three above are the only
ones there are.

`.agents/` is where everything an agent runner reads lives: the agents, the
hooks, the skills, the plugins CI installs from its own marketplace, and
`.agents/codex/` for the runner that reads a config instead. `.claude/agents`,
`.claude/hooks` and `.claude/skills` are symlinks into it, so a rule is written
once and every runner obeys it. Add a skill, an agent, a hook or a plugin under
`.agents/`, never under `.claude/`.

Keep for yourself the file you are about to edit, the edit, and the short
command whose whole output you actually want. Anything long, wide or repeated is
theirs.

## Worktrees

Every git worktree lives in `worktrees/` at the repository root, at the path of
its branch: `worktrees/<type>/<slug>` for a branch named `<type>/<slug>`. The
type is a commit type (`feat`, `fix`, `refactor`, `ci` and so on), so a branch
is named for the commit it is headed to, and its worktree is filed with the
others of its kind. This holds for Claude, Codex and any other agent runner, and
for a worktree you add by hand. Never put one under `.claude/`, a sibling of the
repository, a temporary directory, or flat at the top of `worktrees/`.

The directory is tracked through its `.gitkeep`, and `.gitignore` keeps
everything else in it out of git. Move a worktree with `git worktree move`,
never `mv`, so git keeps track of where it is.

Remove a worktree with `git worktree remove` once its pull request is merged,
and delete its branch with it. Do the same for a worktree whose branch has no
remote and is no longer worked on. Never delete a worktree's directory by hand:
git loses track of it, and what is left is a directory no git command will
clean up.

## What this is

A Lisp interpreter designed to be the deterministic "brain" of an AI agent in a
neuro-symbolic architecture. The `README.md` is where that idea is written out.

It is a **Turborepo** pnpm monorepo (`pnpm-workspace.yaml` + `turbo.json`),
workspaces `packages/*` and `apps/*`. Each one's `AGENTS.md` is the entry point
for working in it.

Not all of it is a workspace. The dialect is served outside the node build too,
and those parts answer to `task` rather than to `pnpm`: `nix/` builds the
`ptcfmt` formatter from the grammar in `packages/tree-sitter` and holds its checks,
`editors/nvim` is the editor plugin, and `examples/` is the dialect written out.
A change to the language surface is not done until they still pass.

The test cluster is not a workspace either, and it answers to `task` as well.
What it runs is deployed from `main` alone, except a pull request labeled
`preview`, which runs in a namespace of its own until the label or the pull
request goes away. A service added to the local stack is not deployed until the
cluster runs it too, and a URL the stack derives from its hostnames has to be
derived for a preview as well.

### Packages

The core language, and nothing else:

- `packages/interpreter` (`@repo/interpreter`) — the reader, the evaluator, the drivers, the prelude, and the three seam mechanisms an extension plugs into. It ships no extension and names none. Owns the host-port and seam patterns.

The extensions, one language surface each. Every one depends on the
interpreter, reaches the world only through ports it declares itself, and is
named only at a composition root:

- `packages/agents` (`@repo/agents-extension`) — what the language asks of the harness: what reaches the agent, and when, and the sub-agents it starts.
- `packages/compaction` (`@repo/compaction-extension`) — bounded output.
- `packages/intent` (`@repo/intent-extension`) — what the agent shows the user of its intent: what it does now, its todo, the question it asks.
- `packages/introspection` (`@repo/introspection-extension`) — reading what is defined.
- `packages/knowledge` (`@repo/knowledge-extension`) — the files the user uploaded to a workspace, read and written by the agent.
- `packages/llm` (`@repo/llm-extension`) — the language-model extension.
- `packages/mcp` (`@repo/mcp-extension`) — the MCP extension.
- `packages/memory` (`@repo/memory-extension`) — the memory extension.
- `packages/permissions` (`@repo/permissions-extension`) — what a session may call: allowed, denied, or waiting on a human.
- `packages/promises` (`@repo/promises-extension`) — asynchrony.
- `packages/preferences` (`@repo/preferences-extension`) — the user's preferences: theme, font, what the chat shows.
- `packages/prose` (`@repo/prose-extension`) — the prose the model writes around its forms.
- `packages/secrets` (`@repo/secrets-extension`) — the secret registry.
- `packages/ui-extension` (`@repo/ui-extension`) — the UI surface.
- `packages/workspace` (`@repo/workspace-extension`) — the workspace's settings and its chats.
- `packages/checks` (`@repo/checks`) — the check extension: the DSL an eval case is written in.

Everything else:

- `packages/repl` (`@repo/repl`) — REPL front-ends over the interpreter.
- `packages/ai` (`@repo/ai`) — the agent loop and what it runs on.
- `packages/evals` (`@repo/evals`) — the eval driver, the report it writes, and everything that reads one back.
- `packages/shared` (`@repo/shared`) — the utility layer, with zod as its only dependency.
- `packages/toolkit` (`@repo/toolkit`) — the bundled MCP toolkit manifest, read by the MCP extension.
- `packages/syntax` (`@repo/syntax`) — the lisptc language for the highlighter.
- `packages/tree-sitter` (`@repo/tree-sitter`) — the tree-sitter grammar, compiled by nix for `ptcfmt`.
- `packages/language-service` (`@repo/language-service`) — completions, hover, errors and call hints over lisptc text, for the language server and the chat input alike.
- `packages/env` (`@repo/env`) — typed env. The only place `process.env` is read.
- `packages/backend` (`@repo/backend`) — the Convex deployment, and the auth instance whose database is Convex itself.
- `packages/ui` (`@repo/ui`) — the base design system.
- `packages/components` (`@repo/components`) — the components we wrote, on top of `@repo/ui`.
- `packages/bloub` (`@repo/bloub`) — the avatar component and its engine. Carries the repo's only carve-outs.
- `packages/tsconfigs` — shared tsconfig bases.

### Apps

- `apps/app` (`app`) — the web frontend, and the server that streams the agent loop.
- `apps/cli` (`@lisptc/cli`) — the interactive terminal REPL.
- `apps/dashi-code` (`@lisptc/dashi-code`) — the code dashboard: what production runs, what it never touches, and what keeps changing.
- `apps/lsp` (`@lisptc/lsp`) — a language server for the lisptc dialect.
- `apps/mcp` (`@lisptc/mcp-repl`) — an MCP server exposing the REPL to an MCP client.
- `apps/mcp-toolkit` (`@lisptc/mcp-toolkit`) — the MCP servers we write ourselves, pointing outward.
- `apps/trace-viewer` (`@lisptc/trace-viewer`) — a viewer for eval runs, and the home of the eval cases and their concrete hosts.

## Dependency flow

Dependencies run one way, and only one way:

```
interpreter  →  extensions  →  repl front-ends  →  agent  →  apps
```

- The interpreter depends on no workspace package that depends on it.
- The interpreter is the core dialect and the seams, and stops there. It
  defines the shape an extension satisfies, the chains an extension hooks and
  the slots an extension fills, and it ships none of its own. Every surface
  past the core dialect lives in an extension package, so a new form belongs in
  an extension unless the evaluator cannot run without it.
- An extension package depends on the interpreter, and carries the SDK its
  surface needs so the interpreter never does. **It depends on no other
  extension.** The `extension` tag denies itself, so naming a sibling in a
  manifest fails `pnpm boundaries`. What one extension needs to read off
  another it borrows as a contract type, never as a dependency. Borrowing one
  is deliberate and costly: every check that guards the layering has to be told
  in place, and `packages/checks` is the worked example to copy. It buys a type
  and nothing else, so a value still comes through a port or a slot.
- A REPL front-end and the agent depend on the interpreter, and on no
  extension. A REPL is built from the extension list it is handed. The `runtime`
  tag denies `extension`, so naming one in a manifest fails `pnpm boundaries`,
  in a test as much as in `src/`.
- An extension is named at a composition root, and there are only two: an app
  that runs a REPL itself, and `@repo/backend` for the agent `apps/app` serves.
  Adding one to the served agent means adding its prompt to what `apps/app`
  ships, and `apps/app/AGENTS.md` carries that rule.
- `@repo/shared` carries zod and no other dependency. `@repo/ui` carries no
  workspace package.
- A package tagged `static` is data, like `@repo/toolkit`. It depends on a
  `foundation` package at most, and every package and app may depend on it.
- `@repo/backend` depends on no workspace package that reads it, and nothing
  above it reaches past the entrypoints its `package.json` exports. Its stores
  satisfy the language's ports and its `agent-repl` composes the extensions the
  served agent runs on, so it names the language and the extensions; neither
  ever names it.
- `@repo/evals` drives an eval suite, but it names no extension and no host.
  The app that owns the cases supplies the REPL, check evaluator, mocked hosts
  and judge. `@repo/evals` writes the finished run and reads one back.

That layering is declared, not described. Each package carries a `turbo.json`
naming its tag, and `boundaries.tags` in the root `turbo.json` says which tags a
tag may not depend on. `pnpm boundaries` fails on a wrong-direction dependency,
on an import of a package missing from a `package.json`, on an import that
reaches into another package's files, and on cycles between workspace packages.
It does not detect circular imports between files within a package. Do not add
circular imports between files in a package.

A name is exported once, by the module that declares it, and imported from
there. No module re-exports a name it imported, and none renames one with an
alias type or const. Only a package's root entrypoint gathers names, and only
from its own files. `check:arch` fails on a relay. `scripts/check-arch/`
(`pnpm check:arch`) holds the rules a manifest cannot express, one check per
file, including the two below. Every failure prints the way out. Take it. Do not
widen a list to get past one.

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

## Prompts

**Every prompt an extension ships is written in caveman voice.** A `.ptc`
prompt is read by the model on every turn, so each word it carries is paid for
on every turn. Write a new one, and rewrite a changed one, by the rules of
`.agents/skills/caveman/SKILL.md`. The skill exempts what is persisted
outside chat; a prompt is the exception to that exemption. Every form, keyword,
id and negation survives the rewrite exactly, and a test that pins the old
wording is changed to match.

The caveman voice is for the prose around the language, never for the language
itself. Every symbol, operator, signature and example form a prompt carries is
what the evaluator implements, so it is copied character for character. A
rewrite that treats `*` or a backtick as markdown and strips it teaches the
model code that does not run: `(* n n)` becomes `(n n)`, `let*` becomes `let`,
`*version*` becomes `version`, a quasiquoted expansion loses its backtick. An
example a prompt shows still evaluates to the result the prompt claims for it.

## Comments

**The code carries no comments.** Three guards hold it, at commit, at push and
in CI, so one cannot reach main. The only ones allowed are directives a tool
reads, and those are not prose. `no-comments.json` is where that allowance is
written, so a new directive is added there rather than argued for in a review.

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

**Secrets live in Infisical, and nowhere else.** A `task` command fetches them
at run time, so no secret is written into the tree. No `apps/*` or `packages/*`
directory carries a `.env` file of any kind. The only one allowed is the
repository's top-level `.env`. An agent never reads it, never writes it, and
never copies it, so a value it needs comes through Infisical or is asked of the
user.

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

A test belongs to the package that owns what it asserts. A surface an extension
owns is tested in that extension's package, never in the interpreter, whose
helpers build an interpreter with nothing installed. A runtime package's tests
name no extension either: a REPL there is built from stubs that hook the chains
and fill the slots, so what is pinned is the seam rather than whoever happens to
be on it. An extension's own tests install that extension and no other. A test that needs
two at once belongs in `@repo/backend/test/extensions`, the composition root
that already names them all.

The agent evals are separate: the cases live in `apps/trace-viewer/evals` as
`*.eval.ts`, they run against real models, and `pnpm test` does not include them.
`pnpm test:evals` runs them.

## Commands

Root scripts delegate to Turbo:

```bash
pnpm test                    # turbo run test (vitest run in each package)
pnpm typecheck               # turbo run typecheck (tsc --noEmit per package)
pnpm lint                    # biome ci (lint + format check) — matches CI, run at root
pnpm format                  # biome check --write (auto-fix)
pnpm knip                    # dead-code / unused-dependency check (part of CI), run at root
pnpm fallow                  # changed-code risk and dead code audit (part of CI), run at root
pnpm boundaries              # package layering + import rules (part of CI), run at root
pnpm check:arch              # manifest rules boundaries cannot express (part of CI)
pnpm check:comments          # fails on any non-directive comment (part of CI), run at root
pnpm fix:comments            # strip them; follow with `pnpm format`
pnpm check:docs              # fails on tracked markdown outside the allowlist (part of CI)
pnpm fix:docs                # delete those files
pnpm check:refs              # AGENTS.md references that no longer resolve
pnpm check:refs --all        # sweep every AGENTS.md; what CI and `.husky/pre-push` run
pnpm test:watch              # turbo run test:watch
pnpm test:evals              # agent evals against real models (NOT part of `pnpm test`)
pnpm repl                    # turbo run repl (run the interpreter REPL directly)

task check:agents            # judge the AGENTS.md prose a PR adds (needs the /actions/agents-md secrets)
task check:agents -- --all   # sweep every AGENTS.md, not just the ones a PR changed
task up                      # build and run the whole stack in docker, with live reload
task test                    # the vitest suites and the nix flake checks together
task test:nix                # the nix flake checks, the ptcfmt formatter test included
task test:nvim               # the nvim integration test
task convex:generate         # start the local convex backend and regenerate packages/backend/convex/_generated

# Single test file / by name — run inside the package that owns it:
pnpm --filter @repo/interpreter exec vitest run test/macros.test.ts
pnpm --filter @repo/interpreter exec vitest run -t "name of test"
```

Every `task` runs under Infisical: `/db` holds the postgres credentials and the
database name, `/convex` the deployment's secret and its origins, `/auth`
everything Better Auth signs and calls out with, the deployment's admin key
included, so the convex CLI is credentialed wherever that environment reaches.
`/grafana` holds the cluster Grafana's admin login, which both Grafana itself
and the `grafana` MCP server in `.mcp.json` read. `/argocd` holds the cluster
Argo CD's admin password, and its base URL and API token, which the `argocd`
MCP server reads.

The remote Turbo cache is shared, and `turbo.json` is where it is named. Its
token is a secret like any other, kept at the `/turbo` Infisical path.

Runtime requires **Node >= 22.6.0**, and `.ts` files run directly with no build
step. `.github/workflows/` holds the CI jobs and the order their checks run in,
`.husky/` what a commit and a push have to satisfy first. A check that fails
there fails the same way locally, under the command it names.

**Do not run the checks yourself before a push.** `.husky/pre-push` runs them
and refuses a push that fails, and CI runs them again. When the user asks to
push, push. If the hook or CI fails, read the failure, fix it, and push again
without being asked. While the work is still moving, check a change with the
tests and the typecheck of the package it touches, and nothing wider.

## Commits

A commit message is a conventional commit, `type(scope): subject`, and
`.commitlintrc.ts` is where the allowed types and the limits are written, and
`.husky/commit-msg` rejects a message that breaks them.

- The scope names the workspace the change lives in, by its short name:
  feat(permissions), fix(app) or chore(ui). A change that spans several
  workspaces takes the one its point is about.
- The subject is lower case, says what the change does, and ends without a
  full stop. The whole header stays within 100 characters.
- `harness` is reserved for what an AI agent reads or runs: the `AGENTS.md`
  files and the agent rules under `.agents/`, with the hooks, the agents and
  the skills that live there. It takes no scope:
  `harness: add instruction to only run typecheck at the end`. An `AGENTS.md`
  change is `harness`, never `docs` or `chore`.
- `ci` is the type for how CI runs and the checks that guard the repo: the
  workflows under `.github/workflows/` and the actions under `.github/actions/`,
  a check script, a husky hook, a `no-comments.json` allowance, the test and
  coverage setup. It takes no scope: `ci: cache the pnpm store in every
  workflow`. None of that is `harness`.
- `eval` is the type for a change to the eval cases.

A commit is its title. `body-max-lines` rejects a body longer than one line, so
write the subject and stop unless a description was asked for, and then keep it
to a single line after the blank one. Trailers like Co-Authored-By are footers
and do not count.

One commit holds one concern. Unrelated changes in the tree go in commits of
their own.

## Issues

Work found along the way and left out of the current change is written up as a
Linear issue in the lisptc team (key PTC), so it is not lost in a reply.
Open one when the user asks, or when a defect or follow-up is deliberately set
aside, and say so in the reply with the link.

**Every issue an agent opens carries the "generated" label.** It is the
existing label for that, so do not create another. Add a type label such as
bug, feature, refactor or improvement when one fits.

An issue states:

- what is wrong or missing, anchored to the files and functions involved;
- the impact, concretely: who can do what, and what breaks;
- the fix as a direction, not a finished design;
- where it was found and why it was kept out of that change.

Leave priority, assignee and cycle to the user unless they named them. Search
for an open issue covering the same thing first, and comment on it instead of
opening a duplicate.

## Writing Style

These rules cover everything written here. Prose, documentation, commit
messages, and every reply to the person you are working with.

- Do not use "It's not that X, it's that Y" constructions. Rewrite as a direct statement.
- Do not open responses with affirmations ("Certainly!", "Of course!", "Absolutely!").
- Do not use "It's worth noting", "it's important to mention", or similar throat-clearing.
- Do not narrate your process ("Let me walk you through..."). Just do the thing.
- Prefer active voice over passive voice.
- Prefer short sentences. Break compound thoughts into separate sentences.
- No em dashes. Use a comma, colon, or separate sentence instead.
