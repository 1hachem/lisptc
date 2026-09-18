# @repo/evals

The eval suite around `@repo/checks`, and all of its reporting. It holds no
cases of its own. The cases live in `apps/trace-viewer/evals`.

Turbo tag: `extension`.

## Shape

Two halves, and the split is the point.

**The half that runs a suite.** `src/harness.ts` builds a traced REPL,
`src/runner.ts` runs a case and scores it, `src/judge.ts` is the model judge,
`src/targets.ts` reads the matrix of models to run against, and
`src/global-setup.ts` prepares a run and merges the shards at the end.
`src/shards.ts` holds the shard paths.

**The half that reads a finished run.** `src/report.ts` holds the schemas a
report is parsed with, `src/review.ts` turns a run into trace events and
review properties, and `src/storage.ts` reads and writes reports to disk or R2.

## Rules

**The running half is importable only where the cases live.**
`check:arch` allows `@repo/evals/harness`, `/runner`, `/judge`, `/targets` and
`/global-setup` in `apps/trace-viewer/evals/` and its vitest config, and
nowhere else. Everything that reads finished runs imports `/report`, `/review`
and `/storage` instead, so a page never pulls in a test runner or a model
provider. If a page needs something from the running half, the thing to move is
the shape, into the reading half.

A report is parsed through its schema, never cast. The schemas are the contract
between a run and everything that reads it.

## Commands

```bash
pnpm test:evals    # real models, NOT part of pnpm test
```
