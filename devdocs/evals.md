# The eval suite

`packages/evals`. An eval seeds a conversation, lets the agent run against a
mocked world, and asserts temporal properties of what it did. It answers a
question the unit suites cannot: does *this model* drive *this language* well,
and better or worse than the last one.

`@repo/evals` is the engine and holds no cases. The cases live in
`apps/trace-viewer/evals/*.eval.ts`, next to the app that displays their
results, and `pnpm test:evals` (or `task test:evals` for the Infisical-wrapped
local run) runs them there under their own vitest config. They are **not** part
of `pnpm test`: turbo only runs a task where the script is declared, and only
the app declares `test:evals`.

Putting the cases in the app rather than the library is what makes the app a
workbench instead of a dashboard: one place writes the cases, runs them, keeps
the reports and reads them back.

## The report is a typed contract, both ways

`packages/evals/src/report.ts` holds zod schemas whose **inferred types are the
only definition** of `Grade`, `Verdict`, `CheckOutcome`, `ReportRow` and
`Report`. The runner builds a `Report` (so a drifting writer fails to compile)
and validates it with `reportSchema.parse` before writing (so a field the type
cannot catch still fails loudly). The viewer imports the same module and calls
`parseReport`, which `safeParse`s.

Rename a field in the schema and *both* sides go red: the runner cannot
construct the row, and the viewer cannot read the property. That is the point —
the two are separate packages and nothing else would keep them honest.

A report carries the **setup as well as the results**: `cases` holds one entry
per `evalCase` with its step band, sample count, whether the system prompt was
the default, the seeded turns, a summary of each mocked server (its tools, the
ones actually answered, the connect delay, whether it fails) and the raw
lisptc check source. It is recorded at declaration, once per case rather than
once per row, since it is the same for every target the case runs against.

That is what lets the viewer explain a grade instead of only stating it. A
`degraded` with no visible band is unreadable: you cannot tell whether the
model wandered or the `min` was optimistic. Recording only `steps` was exactly
that mistake.

`parseReport` returns `{ok, report} | {ok, why}` rather than throwing, and the
formatting of the failure lives in `report.ts` beside the schema. It has to:
`instanceof ZodError` in the viewer compares against the viewer's own copy of
zod and is false for an error thrown by the library's copy, so the check
silently fails and the UI dumps raw issue JSON. Formatting where the schema
lives sidesteps the dual-instance problem entirely and keeps zod out of the
app's dependencies.

A report the schema rejects is listed as unreadable with the offending field
paths, never rendered as a blank or half-filled run — an old report from before
a shape change should say so, not lie.

## What is mocked, and what deliberately is not

These evals measure the agent's logic, not the REPL's functionality, which has
its own suites. So `(load-mcp "playwright")` answers "loaded" without spawning
anything.

The mock sits at the **`Dispatch`**, not at `load-mcp`. That is what keeps the
agent's surface honest: `mcp.ts` still mints the real `<server>/<tool>`
bindings from the tool list the mocked `connect` returns, still registers their
docs, still runs `validate(tool, args)` against their schemas, and `load-mcp`
still returns a real promise. Replacing the built-in instead would test a
different language from the one the agent will meet.

**The toolkit stays real.** `list-toolkit`, `search-mcps` and `search-tools`
are answered locally and never dispatch, so `mcp.toolkit.json` gives the agent
the real discovery surface — which is exactly what `finds-the-server` is
testing. Only execution is mocked.

**Tool descriptors are recorded, not written.**
`test/fixtures/playwright.tools.json` was captured from a real `connect`.
Hand-written schemas drift from the server and quietly stop catching the agent
passing wrong arguments. Regenerate it by
wrapping `mcpDispatch` and keeping the `tools` off a real connect.

`linear.tools.json` is the exception, and a debt rather than a pattern.
`mcp.linear.app` answers `401` to an unauthenticated `initialize`, so capturing
it needs someone to complete the OAuth flow first; it was written from Linear's
documented tool set instead. Recapture it the first time anyone has a Linear
token in hand. Until then the risk is the ordinary one for a hand-written
schema: `linear/list_issues` may accept an argument the real server rejects, so
`calls-nothing-that-does-not-exist` is weaker than it reads.

**A mocked connect is slow on purpose.** `load-mcp` returns a promise, and a
connect that has already settled by the next step makes `waits-for-the-load`
pass vacuously — the agent gets credit for an ordering it never had to
respect. Hence `connectDelayMs`, the same trick `LISPTC_FIXTURE_DELAY_MS`
plays for the interpreter's own fixture server.

**A mock never tells the agent it is a mock.** An unmocked server or tool
fails with `cannot start MCP server "pw"` or `pw/go is unavailable`, not with
the old `add it to the case's mocks`, which taught a recovering agent that it
was inside a test harness and gave it no in-world reason to stop. The hint the
eval author needs is still printed, on `console.warn`, where the runner's own
output is.

**A server the case forbids still has to be mocked.**
`(never (called-server-other-than "playwright"))` can only be falsified by a
tool call on another server, and a server with no mock cannot connect, so
without `linear` in the case's `mocks` the check passes on every run without
ever being tested. The mock is what puts the temptation in the world.

**A mock that always answers nothing is a trap.** `browser_find` returning
`{matches: []}` made the cheapest correct path a dead end and pushed every
agent onto the full snapshot, so the case measured the fixture's stinginess
rather than the agent's judgement. A mocked tool should answer the way the real
one would for the page the fixture describes.

**Failure is a case, not an accident.** A server's `fails`, and a per-tool
`error` result, are how the suite evals whether the agent recovers. Nothing
else can reach that behaviour.

The real fixture servers in `packages/interpreter/test` stay where they are.
An eval reaches for one only when the case is about the real SDK path.

## Two recorders, because one cannot see everything

- **`evalForm`** sees what the agent *wrote*: every top-level form, its value,
  and whether it raised. The recorder is appended after `compactionExtension`
  in the roster, which by the chain's outermost-first order puts it innermost,
  so it sees the raw value before compaction names it.
- **A wrapping `Dispatch`** sees what actually *happened*. `evalForm` only
  wraps top-level forms, and half the interesting calls are nested
  (`(await (load-mcp …))`, a tool call inside a `let`).

Three traps that produce a wrong trace if missed:

- **`call-tool`'s payload carries `serverId`, a UUID, not the server name.**
  The name lives only in the `connect` payload. The recorder builds a
  `serverId → name` map from connect results and joins on it.
- **Secrets are plaintext in tool arguments.** `plistToJson` calls
  `Secret.toJSON()`, which reveals, so a naive recorder writes them into the
  report artifact. Arguments are scrubbed against the REPL's secret store at
  record time.
- **Timeouts settle outside `dispatch`.** `withTimeout` wraps the dispatch
  promise, so the recorder sees the underlying call's real settle, not the
  timeout the Lisp side observed. The Lisp-visible outcome comes from the
  `evalForm` side.

Neither recorder sees `llm/*` calls (own seam, `llmExtension({ observe })`),
the local-only `list-tools`/`search-tools`/`search-mcps` built-ins, or the
promise combinators. A check written against those from the runtime side would
silently never fire; `called` covers the local built-ins by reading the
recorded *form* instead.

Both hang off options that did not exist before: `mcpDispatch`, `toolkitJson`
and `extensions` on `MemoryRepl`, forwarded from `freshInterp` so a recorder
**survives `reset()`**. The `setup(interp)` hook is a tempting shortcut but
cannot reach the `Dispatch`, which is captured in a closure at `registerMcp`
time.

### One call, two seams, one hit

A call the agent wrote *and* the runtime ran shows up twice: once as the
top-level `form` that contains it, once as the `connect` or `tool` event it
dispatched. Ordering combinators do not care, but counting ones do, and
`(at-most (called "load-mcp" "playwright") 3)` used to latch false at the
**second** attempt: the check read as "stop retrying" and fired on an agent
that had retried once. A run was graded against the agent for the harness's
double vision.

So `called` keeps every dispatch hit, and drops a written hit whose step
already has one for that name. A call that never reached `Dispatch` (an
undefined `server/tool`, a form that raised before it ran) still counts as
written, which is what keeps `looks-up-tools-before-navigating` honest about a
tool the agent reached for and missed.

## Checks: three-valued, and latched

Every unresolved check is re-evaluated after each interaction against the trace
so far. The moment it resolves to true or false it **latches**: it stops being
evaluated and that value is what the run reports. First decision wins, so
`(before A B)` decides at the *first* A and a later A cannot undo it.

Every node is three-valued, and a matcher over a prefix returns its matching
positions or **nothing — never a verdict**: a later step could still satisfy
it. Only a combinator turns that into true, false, or a pending value.

The implementation re-scans the whole prefix each step rather than keeping an
incremental automaton. Traces are tens of events; the simpler thing is free.

### A pending check is not always false

The obvious rule — pending at the end counts as false — is right for liveness
and **wrong for safety**. Under it,
`(never (called-server-other-than "playwright"))` could never pass: it is only
ever falsified, never verified, so a perfectly behaved agent leaves it pending
and the check fails on a clean run.

So the end value belongs to the combinator:

| form | latches true | latches false | pending at end |
| --- | --- | --- | --- |
| `(eventually a)` | a occurs | — | false |
| `(never a)` | — | a occurs | **true** |
| `(always a)` | — | a step goes by without a | **true** |
| `(before a b)` | first a, b already seen | first a, no b seen | false |
| `(requires a b)` | first a, b already seen | first a, no b seen | **true** |
| `(after a b)` | b occurs after the first a | — | false |
| `(within n a)` | a occurs by step n | step n passes without a | (decided) |
| `(once a)` | — | second occurrence | true iff exactly one |
| `(happens a n)` | — | occurrence n+1 | true iff exactly n |
| `(at-most a n)` | — | occurrence n+1 | **true** |

`(without a b)` is not a combinator but a matcher: the positions in `a` that
are not in `b`, so a check can name "any playwright tool that is not
`browser_navigate`".

`within` is the only one that latches false from the clock alone, which is what
makes `stops` decide during the run rather than at teardown.

### `requires` is `before` without the demand

`(before A B)` insists A happens. That is right for `finds-the-server`: an
agent that never loads a server has not passed. It is wrong for a guard like
"the first playwright tool it reaches for is `browser_navigate`", where the
thing being guarded against ideally never happens at all:

```
(defcheck navigate-is-the-first-tool-it-reaches-for
  (requires (without (called-server "playwright")
                     (called "playwright/browser_navigate"))
            (called "playwright/browser_navigate")))
```

`requires` latches false at the first A with no preceding B, exactly like
`before`, but ends **true** when A never happens. Reach for `before` when A is
part of the task, and `requires` when A is a mistake.

### `before` reads backwards from the obvious

`(before A B)` is **"before A happens, B should happen"**: B precedes A. The
sketch in `research/evals.md` has its arguments the other way round. `after` is
the mirror, and both read as English:

```
(defcheck finds-the-server
  (before (called "load-mcp") (called-any "search-mcps" "list-toolkit")))
```

### The DSL refuses nonsense

Matcher results are tagged, not bare lists, so feeding a combinator another
combinator's verdict — `(never (happens (called "x") 4))` — raises instead of
quietly reading as zero matches and answering true. A check whose body is a
matcher rather than a combinator raises for the same reason. `evalCase` also
builds and runs each case's checks against an empty trace **at declaration**,
so a malformed check throws while the file is merely being collected — and
`@repo/evals`'s ordinary `test` script ends with `vitest list` over the eval
config, which collects every `.eval.ts` without running a single model. A
malformed eval therefore fails on a PR rather than at 3am.

### Halting is the band's job, not a check's

`(within max (halted))` was in every case and asserted nothing the grade did
not already. `max` *is* the loop's `maxSteps`, so `steps` can never exceed it,
and the clock branch that makes `within` latch false never fires. The check
ends pending-false exactly when the run ends unhalted, which is already a fail.
The same goes for `(eventually (halted))`. Both are gone.

`within` earns its place on a deadline the band cannot express: an intermediate
call by step n, or `(within min (halted))` to make a late answer a hard fail
instead of a degrade.

The signal underneath is the loop's own. A reply that **runs nothing** is the
answer (see [repl.md](./repl.md)), so a model that answers with
`(echo "the heading is …")` instead of bare prose has run something, the loop
keeps going, and it burns every step to the cap while the transcript's last
lines read like a perfectly good answer. That is worth failing on, because
those wasted steps are the user's tokens. The run has to say so plainly, hence
the summary line reads `NEVER ANSWERED — ran to the 12-step cap` rather than
only `FAIL`, and the failure message names it before any check.

### `answered` is the only check on what the user gets

Every other matcher reads the trace of what the agent *did*. `answered` reads
the final reply itself: `(eventually (answered (matches "Build AI workflows")))`
is how a case whose prompt asks a question checks that the question was
answered. Without it a case can only assert that the agent called the tools
that would have told it the answer, which is how
`finds-a-browser-loads-it-and-opens-the-page` spent half its budget chasing a
heading no check ever looked at.

It takes the same argument matchers as `called` and ANDs them, and it matches
against the halting reply verbatim, prose and all.

### `awaited` is syntactic

`await` is a promise built-in and never passes through `Dispatch`, so
`(awaited "load-mcp")` is a claim about the code the agent wrote: a call to
that name, or a symbol named after it, inside an `await`. It follows the
compactor's minted names, so `(await load-mcp-1)` counts. It does **not**
follow a value through a variable, so `(setq p (load-mcp …))` then `(await p)`
reads as not awaited.

Usually the runtime form is what you actually mean:
`(before (called-server "playwright") (called "load-mcp"))` says the same thing
and is a fact rather than a guess.

## Seeding replays code, not transcript text

A seeded case is **code**. Replaying fabricated turns would put the model in a
state where the transcript says `(await load-mcp-1)` happened while the
interpreter has no such binding, and every check downstream would be measuring
recovery from an impossible state.

The runner replays a seed through the same `AgentRepl` and the same `evalCode`
the loop uses: a `user` entry becomes a transcript message; an `assistant`
entry is actually evaluated, and the real tool result goes into the transcript.
State and history then agree by construction. Seed steps are recorded into the
trace at step 0 and excluded from `steps`.

`runAgentTurn` copies the transcript it is handed, so a fixture reused across
samples does not grow a turn each run.

## Grading, and what a run records

| condition | grade |
| --- | --- |
| every check true, `steps <= min` | pass |
| every check true, `min < steps <= max` | degraded |
| any check false, `steps > max`, or no answer | fail |

`min` is the number of round-trips it takes to nail it; `max` is the budget,
and it is also the loop's `maxSteps`, so a run that never answers is a fail
rather than an overrun. Degraded is recorded, not failed.

One run per case by default. `samples: k` with a `passRate` floor buys repeats
where a case is known to be borderline; a model is stochastic and one run is a
coin flip, so a single red case is evidence, not proof.

**Input tokens are not summed.** Every model call is handed the whole
conversation, so each step's input count already contains the ones before it
(see [agent-loop.md](./agent-loop.md)). The report takes the last step's input
count and sums only the outputs.

Beyond the checks, each run records steps, tokens, wall time, REPL error count
and prose-skip count, because a set of booleans that all still pass hides a
regression from 4 steps to 9.

## Scoring models against each other

`EVAL_MATRIX` is a comma-separated list of `provider:model` pairs, defaulting
to the default provider and its default model. Every test name and every report
row carries the pair.

**Record the resolved model, not the requested one.** `defineProvider` falls
back to `spec.defaultModel`, so a case run without an explicit model must
report that default or the row scores nothing.

**A provider with no key is skipped, not failed.** `providerSpecs` is a
snapshot of the environment taken at import and a missing key yields
`apiKey: undefined`; the throw comes later, at model construction. `llamacpp`
hardcodes its key, so naming it in `EVAL_MATRIX` is taken as meaning it.

Every run writes one report into the app's gitignored `.evals/`, named for when
it ran and what it ran against:

```
apps/trace-viewer/.evals/2026-09-10T13-55-11__digitalocean-gemma-4-31B-it__openrouter-deepseek-deepseek-v4-flash-0731.json
```

Reports accumulate rather than overwrite, which is the point: scoring a model
against the last one means having the last one. The name carries the timestamp
and up to three `provider-model` slugs (then `and-N-more`) so a directory
listing alone answers "when did we last run deepseek". Inside is `startedAt`,
the git `sha`, the resolved `targets`, and one row per (case, provider, model,
sample) with the grade, steps, tokens, the full transcript, and each check's
verdict and the step it decided at.

The directory is `.evals` under the vitest project root, which puts reports
beside the cases that produced them and under the app that reads them.
`EVAL_REPORT_DIR` overrides it.

### One report per invocation, out of one shard per worker

`rows`, `cases` and `STARTED_AT` are module state in `runner.ts`, and a vitest
worker gets its own module registry per test file — with `isolate` on that is
true whether or not files run in parallel. So the obvious thing, each worker
writing `<STARTED_AT>__<targets>.json` directly, silently turns one invocation
into N reports the moment there is a second `.eval.ts`, each holding a slice of
the cases and each listed by the viewer as its own run. That was the state of
things while `browsing.eval.ts` was the only file, which is exactly why it went
unnoticed.

So a worker writes a **shard** instead: a whole, schema-valid `Report` at
`.evals/parts/<startedAt>-<pid>.json`, rewritten after each of its cases so a
long run is still watchable. `global-setup.ts` clears `parts/` before the run
and merges it after: cases deduped by name, rows concatenated and sorted by
case then sample, `startedAt` the earliest of the shards. The merged file is
the only thing that lands in `.evals/` itself, and `parts/` is a subdirectory,
so the viewer's `readdirSync(...).filter(endsWith(".json"))` never sees a shard.

A shard carries `targets` and `startedAt` of its own rather than having them
handed down from the main process. That is what keeps `global-setup.ts` free of
any import from `runner.ts`, and so free of the whole agent stack, in the
process vitest starts before any worker.

The cost is that a run killed mid-flight leaves shards and no merged report.
That is the right way round: a half-run is not a run, and the next invocation
clears them.

## The viewer

`apps/trace-viewer` is a Next.js app-router app, server components only — it
reads the filesystem and renders; there is no client state and no API layer,
because the data is a directory of JSON on the same machine. `/` lists runs
newest-first with the date, the targets and a pass/degraded/fail tally; `/r/…`
opens one and shows every row's grade, how it ended, its checks with the step
each decided at, and the whole conversation.

The app carries **two tsconfigs**, because it has two TypeScript worlds: the UI
is DOM plus bundler resolution, while `evals/` pulls the interpreter and needs
NodeNext with node types. One config cannot serve both — typechecking the eval
cases under the UI's config reports phantom errors inside `mcp-client.ts`. So
`typecheck` runs `tsc` twice, and `tsconfig.json` excludes `evals`.

A check line carries `(decided at step n)` only when it actually latched
during the run; one that collapsed from pending at the end carries nothing.

## The judge

When `EVAL_JUDGE` names a `provider:model`, every finished run is handed to that
model — the case setup, the check source, how each check came out, and the whole
conversation — and asked for a short prose recap. It lands on the row as
`recap`, prints under the transcript, and shows in the viewer.

The judge is asked one thing the checks cannot answer: **when an assertion
failed, was the agent at fault or was the assertion too narrow?** That question
is the whole reason it exists. A check like "call `list-tools` before
navigating" fails an agent that used `search-tools` instead, which is a fine
strategy; the checks report a failure and only a reader can tell it is the
eval's fault. The judge is that reader, at 3am, in a report nobody watched.

**It must not be a model under test.** Grading with the same model shares its
blind spots, so the Taskfile keeps `EVAL_JUDGE` separate from `EVAL_MATRIX`
rather than defaulting one from the other. `EVAL_JUDGE=none` skips recaps
entirely — an *empty* value cannot mean that, because Task's `default` filter
treats empty as unset and hands back the default.

It goes through `@repo/llm`'s `Generate` port, not `packages/ai`'s providers:
those are streaming and pinned to `LISP_GRAMMAR`, which is right for the agent's
own turns and exactly wrong for a reviewer who should answer in prose.

**A judge never fails an eval.** An unreachable provider logs once and skips
every recap; a call that errors or times out is recorded as the recap text
itself. The grade is decided by the checks, and a broken reviewer must not turn
a passing run red or a failing one green.

## Every run prints its transcript

A failing eval is only actionable if you can read what the agent actually did,
and the JSON is the wrong place to read it from. So each run prints, when it
finishes: the grade, steps and token cost; then the user turn, every reply the
model wrote and the REPL's answer **as the model saw it** (the capped copy, not
the human one); then each check with the step it decided at.

## Why this is not in CI

`.github/workflows/ci.yml` is the PR gate and evals are neither hermetic nor
free — the model is still a network call, and still costs money.
`.github/workflows/evals.yml` runs them nightly and on demand, pulls model
credentials through the Infisical action, and uploads the report as an
artifact. It needs `INFISICAL_CLIENT_ID` / `INFISICAL_CLIENT_SECRET` as
repository secrets and `INFISICAL_PROJECT_SLUG` as a variable.

`retry: 0` is deliberate in the eval vitest config: a retry hides exactly what
is being measured.

## Cases run in parallel

Nothing connects one case to another: each builds its own `AgentRepl`, its own
mocked dispatch and its own trace, and the only shared thing is the report,
which is sharded per worker (above). So the suite runs concurrently — files
across workers and cases within a file, since three of the four cases live in
one file and per-file parallelism alone would leave them queued behind each
other. Against a stub model the four cases finish in 2.9s rather than 8.2s.

`evalConcurrency()` (`targets.ts`) is the one knob, and the config feeds it to
`maxWorkers`, `maxConcurrency` and `sequence.concurrent` together.
`EVAL_CONCURRENCY` sets it, default 4.

Two things it is honest about. **1 means serial**, all three settings collapse
and the suite runs exactly as it used to — that is the escape hatch for a
provider answering 429. Above 1 the number is a **per-file cap, not a global
one**: vitest has no cross-worker semaphore, so the true ceiling is workers
times concurrency. For a suite of a handful of cases the burst is small enough
that a real bound is not worth building; if that stops being true, the place to
fix it is a semaphore in `runCase`, not more vitest settings.

**`llamacpp` in the matrix forces 1**, wherever it appears in it, because
`llama-server` runs `--parallel 1` and concurrent requests would queue behind
each other and time out. That check lives in `evalConcurrency()` rather than in
the config, so it cannot be forgotten by whoever writes the next config.
