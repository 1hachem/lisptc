# @repo/landing

The shape of a landing page: the schema a `landing-page.ptc` is validated
against, and the types every reader of one is typed by.

Turbo tag: `foundation`.

## Shape

`src/landing.ts` holds the schema, the types it infers, and the parse that
reports problems by path.

## Rules

A landing page is data. This package describes it and runs nothing. It never
learns how a page is drawn, stored or published, so the store that validates a
save, the components that draw a page and the prompt that teaches the keys all
read the same schema.

zod is its only dependency, so a Convex function can import it. It depends on
no workspace package.

A new section type is added to the schema here first. Every key is strict, so a
misspelt key fails with its path instead of being dropped.

## Tests

`test/`.
