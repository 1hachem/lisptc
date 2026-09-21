# @repo/components

The components we wrote, on top of `@repo/ui`. Both front-ends import them.

Turbo tag: `frontend`.

## Shape

One file per component, flat, with its tests beside it and `src/index.ts`
re-exporting them. The components here are the presentational pieces two
front-ends share: the text animations, the message feedback control and the
recalled memories of a step, with `src/feedback.ts` and `src/memories.ts`
holding the shapes each of those speaks in.

## Rules

A component here is presentational. It takes props and callbacks, and it talks
to no backend, no store and no router. `MessageFeedback` takes a capture
callback rather than reaching for analytics itself, and that is the pattern:
the app wires the effect, the component renders.

A primitive belongs in `@repo/ui`. A component that knows what a message or a
workspace is belongs here. A component that knows about a route or a query
belongs in the app.

`@repo/ui` is the only workspace dependency. Adding another one is a sign the
component belongs in the app instead.

## Tests

Tests live beside the source in `src/`, not in test/, and run under
happy-dom.
