# @lisptc/dashi-code

The code dashboard. What production runs, what it never touches, and what keeps
changing. Next.js, App Router.

Turbo tag: `product`.

## Shape

`src/app/` is the dashboard: the home page lists stored reports, `r/[file]/`
opens one, `versions/` lists stored snapshots and `compare/` puts two of them
side by side. `src/lib/store.ts` declares the document store and its adapter,
`src/lib/report.ts` holds the schema a stored document is read through, and
`src/lib/reports.ts` is what a page calls. `src/components/` holds the
presentation.

## Rules

**A source is read through a store, never through a client.** `DocumentStore`
is the interface and the bucket over the S3 API is the only adapter: the app has
no filesystem mode, so it cannot quietly read a stale copy of the objects. The
`.r2` mount is for a person debugging, never for this app. A page names the
store, never the client. Adding a second source means adding a reader beside
`report.ts`, not an SDK import in a component.

**The analysis runs from the app.** `src/lib/analyse.ts` shells out to fallow,
writes what it gets into the store, and saves a dated version. The refresh
button and a ten-minute poll are the only things that call it, so there is no
task to remember and no way for the stored documents to disagree with what the
page shows. fallow exits nonzero when it finds anything, so `exec` keeps stdout
on a nonzero exit rather than treating findings as a crash.

**A stored document is parsed through its schema, never used as raw JSON.** A
report that no longer matches says why on the page instead of throwing.

Every icon comes from hugeicons, passed as the `icon` prop. `check:arch` fails
on `lucide-react`.

Colors come from the tokens in `@repo/ui`. Gruvbox accents fail a categorical
colorblind check, so identity is carried by a label and color is secondary: a
verdict is written out beside its bar, a part-to-whole is one hue in steps, and
no chart asks the reader to tell green from orange.

## Commands

```bash
task dashi-codes:dev             # dev mode against the bucket
task dashi-codes:open            # build, serve, open a browser
task dashi-codes:capture:docker  # flush a container's V8 coverage for the next refresh
```

Every task runs under Infisical because the bucket credentials live at
`/assets`, and the app refuses to start a store without them.

A capture is one file on purpose. fallow analyses a single local coverage file
without a license and refuses a directory of them.
