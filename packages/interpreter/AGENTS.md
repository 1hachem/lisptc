# @repo/interpreter

The core language and the seams extensions plug into. It ships no extension and
names none: every language surface past the core dialect lives in its own
package above this one. Everything in the repo sits above this package. It
depends on no workspace package that depends on it, and it carries no vendor
SDK: `@repo/mcp-extension` and `@repo/llm-extension` hold theirs so this one
never has to. `pnpm check:arch` fails if the MCP SDK or a langchain package
appears in this manifest.

Turbo tag: `language`.

## Shape

`src/lisp.ts` is the language. The reader, the evaluator, the `Interp` a driver
runs, the `Installable` shape `Interp` installs, and `prelude`, the standard
library written in the dialect itself. Both drivers live here too: the
synchronous pair and the asynchronous pair. A change to evaluation is a change
to this file.

`src/session.ts` is the seam. It declares `SessionHooks`, the chains an
extension hooks, the annotation lanes, `slot`, which mints a capability key, and
`InterpExtension`, the shape an extension satisfies. Read the hook names there,
never from prose. `InterpExtension` is declared here rather than in
`src/lisp.ts` because it names `SessionHooks`, and the seam may know the
language while the language may not know the seam.

`src/hooks.ts` holds the chain machinery the seam is built on. `src/channels.ts`
and `src/channels-host.ts` carry addressed output. `src/arith.ts`,
`src/plist.ts`, `src/async.ts`, `src/timeout.ts` and `src/types.ts` are the
small supporting modules. `src/source.ts` holds the language reference the model
reads.

Nothing `src/lisp.ts` imports imports it back. A helper that needs the
language's own types or errors goes in a module `src/lisp.ts` does not import,
the way `src/plist.ts` and `src/timeout.ts` do.

`src/core.ptc` is the core prompt. It is the only prompt here, because no
extension lives in this package.

An extension is its own workspace package, tagged `extension`, built around the
same files whichever one it is:

- `<name>.ts`, the extension and its host interface.
- `<name>-host.ts`, the implementations and the host value a root passes in.
- `ports.ts`, what both sides need and the host does not own, when there is any.
- `<name>.ptc`, the prompt, written in the dialect.

One whose host has real work to do carries more modules beside them, and those
sit on the host side of the line. A new extension is a new package of those
files. Adding one here instead is the mistake this split exists to prevent.

## Host ports

An extension reaches the world only through an interface it declares itself.
The filesystem, the environment, the network, a subprocess, the clock and its
own prompt all go through one field of that interface.

- `<name>.ts` declares the host interface, one field per port, and is handed
  one. It imports no `node:` builtin, no typed env module, no
  vendor SDK, and never touches `process.env`. What it cannot reach, it cannot
  hard-code.
- `<name>-host.ts` sits beside it, holds the implementations, and exports the
  host value. It is the only file of the pair that touches the world.
- `<name>.ts` never imports `<name>-host.ts`. There is no default host, so
  every caller is handed one and a composition root is the only place that
  names an implementation.
- A type or function both sides need, which does not itself depend on the
  host, lives in the package's `ports.ts` and neither side owns it.
- A port two packages share and neither owns lives in `@repo/shared/host`, with
  its node-side implementation in `@repo/shared/host-node`.
- A port whose work may have to wait is typed so a value or a promise both
  satisfy it, and is consumed through the evaluator's own suspension rather
  than through `async`.

`check:arch` enforces the first three bullets and names the `-host.ts` to move
the offending import to. Type-only imports are allowed, so a port may still be
typed in an SDK's own terms.

Keep a port the evaluator consults on every form synchronous. Give work that
can afford to wait a lifecycle point only the exceptional path reaches. A port
on the hot path buys latency for every form. One on a failure path is paid for
only by the forms that failed.

Adding an extension, or a new outward reach in one, means adding a port. Do not
import `node:fs` "just for this one path". That is the decision the pattern
exists to keep out of the extension.

## The seam, from below

Host ports keep an extension from reaching the world. The seam keeps the world
from reaching in. Nothing above an extension names it, so an extension declares
what it does at each point and what it hands over, and the layers above run it
without knowing it exists.

Three kinds of thing cross, and each has one mechanism.

- Behaviour goes through a chain. Declare a `session` field beside `prompt` and
  hook the points in `SessionHooks`. Give every new chain a base that is correct
  when nobody hooks it.
- A capability goes through a slot. Put a slot beside the contract it hands
  over, which may be a module separate from the extension, so that consuming a
  capability does not pull in what provides it. `memorySlot` and `secretsSlot`,
  each in its own extension package, are the examples.
- Data goes through an annotation. Split a report by audience and by nothing
  else. The extension picks the key and owns the shape.

One verb each way, and they are `emit` and `collect`. An extension emits at a
lifecycle point or on a topic it declares, and collects only from a topic it
declares itself. A driver collects. Nothing reads a payload it did not emit, and
no other spelling for either direction survives review.

Needing something new is never a reason to import across the seam. A new point
in the lifecycle is a new chain. A new capability is a new slot. A new thing to
report is a new key. A payload a layer above would have to interpret belongs
below the seam instead: move the interpretation into the extension.

## Tests

`test/helpers.ts` builds the interpreters, and every one it builds carries no
extension. Use it rather than assembling an `Interp` by hand. A test that needs
a surface an extension owns belongs in that extension's package, not here, and
a fixture here is written in the core dialect because nothing strips prose from
it. Fixtures for the import forms live in `test/fixtures/`.

A test that needs two extensions at once belongs in `@repo/backend`, the
composition root that already names them all.

```bash
pnpm --filter @repo/interpreter exec vitest run test/macros.test.ts
pnpm --filter @repo/interpreter exec vitest run -t "name of test"
```
