# @lisptc/trace-viewer

A viewer for eval runs, and the home of the eval cases. Next.js, App Router.

Turbo tag: `product`.

## Shape

`src/app/` is the viewer: the home page lists reports, `r/[file]/` shows one
run with its setup and transcript. `src/lib/reports.ts` loads and scores them,
`src/lib/reviews.ts` and `src/lib/analytics.ts` carry a review back out.
`src/components/` holds the presentation. `src/middleware.ts` proxies analytics
ingest.

`evals/` holds the cases, one `*.eval.ts` per subject. A case seeds a
conversation, declares the extensions it runs on, mocks the servers it needs,
and declares its checks in the DSL from `@repo/checks`. The check names are the
readable part: they say what the agent should have done, one behaviour each.

`evals/harness/` is the product adapter for `@repo/evals/runner`. Running a
case composes the agent loop, the check extension and a mocked world, so the
app supplies those concrete pieces in `harness.ts`, `runner.ts` and `judge.ts`.
Their unit tests sit beside them and run under `pnpm test`; the cases do not.

## Rules

**A case decides what the agent it tests can do.** There is no default roster
anywhere below: `extensions` is required, and a case that omits one gets a
compile error rather than a REPL someone else chose.

**Nothing under `src/` may import `evals/`.** The pages read finished runs
through `@repo/evals/report`, `/review` and `/storage`, so a page never pulls in
a test runner or a model provider. `check:arch` pins `/global-setup` and
`/runner` to `evals/` and the eval config; the rest of that guard is this rule.

A case asserts through the DSL, not through helpers it imports. Something a case
cannot say is a missing form in `@repo/checks`.

A report is parsed through its schema before a page touches it.

## Commands

```bash
pnpm test:evals    # real models, NOT part of pnpm test
```

`pnpm test` runs the harness's unit tests and then lists the cases, which is
enough to catch a case that no longer parses. It never runs one.
