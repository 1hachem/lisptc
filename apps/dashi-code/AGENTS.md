# @lisptc/dashi-code

The code dashboard. What production runs, what it never touches, and what keeps
changing. Next.js, App Router.

Turbo tag: `product`.

## Shape

`src/app/` is the dashboard: the home page draws the atlas of views,
`versions/` lists stored snapshots and `compare/` puts two of them side by
side. `src/lib/store.ts` declares the document store and its adapter,
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

**The analysis is the app's work, never a task's.** Nothing is run by hand
before a page is opened, and no document enters the store from outside the app,
so what a page shows and what the store holds cannot disagree.

**A stored document is parsed through its schema, never used as raw JSON.** A
report that no longer matches says why on the page instead of throwing.

Every icon comes from hugeicons, passed as the `icon` prop. `check:arch` fails
on `lucide-react`.

Colors come from the tokens in `@repo/ui`. Gruvbox accents fail a categorical
colorblind check, so identity is carried by a label and color is secondary: a
series is written out beside its mark, a part-to-whole is one hue in steps, and
no chart asks the reader to tell green from orange.

## Commands

```bash
task dashi-codes:dev   # dev mode against the bucket
task dashi-codes:open  # build, serve, open a browser
```

Every task runs under Infisical, and the app refuses to open a store without
the bucket credentials. Do not put one in the repo or a shell profile to get
past that.
