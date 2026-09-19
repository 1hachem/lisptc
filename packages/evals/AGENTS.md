# @repo/evals

The eval driver, what a finished run is written as, and everything that reads
one back. It holds no cases, extensions or hosts: the app that owns the cases
supplies those to the runner.

Turbo tag: `runtime`.

## Shape

`src/runner.ts` drives a case through the agent loop and writes report shards.
It is handed a REPL, a check evaluator, trace hooks and an optional reviewer.
`src/targets.ts` reads the matrix of models to run against. `src/report.ts` is
the contract: every schema a report is parsed with, the verdict and outcome
shapes included, so a run and everything that reads one agree on a single
vocabulary. `src/review.ts` turns a run into trace events and review
properties. `src/storage.ts` reads and writes reports to disk or R2.
`src/shards.ts` holds the shard paths a running suite writes into, and
`src/global-setup.ts` prepares a run and merges those shards at the end.

## Rules

**This package names no extension and no host.** It may drive the agent loop,
but it never imports a concrete extension, a `-host` module, a model client or
the check DSL. Running a case composes those pieces in the app, then passes the
small adapter this package needs. If something here starts wanting a concrete
REPL roster, mocked server shape or judge implementation, it belongs on the
other side of that line.

A report is parsed through its schema, never cast. The schemas are the contract
between a run and everything that reads it, and `CheckOutcome` is part of it.

## Tests

`test/storage.test.ts` and `test/review.test.ts`. Product adapter tests live
with their app.
