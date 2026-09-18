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
conversation, mocks the servers it needs, and declares its checks in the DSL
from `@repo/checks`. The check names are the readable part: they say what the
agent should have done, one behaviour each.

## Rules

**The cases are the only place the running half of `@repo/evals` may be
imported.** `check:arch` allows `@repo/evals/harness`, `/runner`, `/judge`,
`/targets` and `/global-setup` in `evals/` and its vitest config, nowhere else.
The pages read finished runs through `/report`, `/review` and `/storage`, so a
page never pulls in a test runner or a model provider. Take the failure's advice
rather than widening the list.

A case asserts through the DSL, not through helpers it imports. Something a case
cannot say is a missing form in `@repo/checks`.

A report is parsed through its schema before a page touches it.

## Commands

```bash
pnpm test:evals    # real models, NOT part of pnpm test
```

`pnpm test` does not run the cases. This app has no unit tests of its own.
