# @lisptc/dashi-code

The code dashboard. What production runs, what it never touches, and what keeps
changing. Next.js, App Router.

Turbo tag: `product`.

## Shape

`src/app/` is the dashboard: the home page lists stored reports, `r/[file]/`
opens one. `src/lib/store.ts` declares the document store and its two adapters,
`src/lib/report.ts` holds the schema a stored document is read through, and
`src/lib/reports.ts` is what a page calls. `src/components/` holds the
presentation.

## Rules

**A source is read through a store, never through a client.** `DocumentStore` is
the interface: the filesystem adapter serves the mounted bucket at `.r2`, the
bucket adapter serves the same objects over the S3 API, and `documentStore()`
picks one from the environment. A page names neither. Adding a second source
means adding a reader beside `report.ts`, not an SDK import in a component.

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
task dashi-codes:local    # the mounted bucket, no secrets
task dashi-codes:dev      # R2 over the API, secrets from infisical
task dashi-codes:open     # build, serve, open a browser
task dashi-codes:capture  # write a local runtime capture into the store
```

A capture is one file on purpose. fallow analyses a single local coverage file
without a license and refuses a directory of them.
