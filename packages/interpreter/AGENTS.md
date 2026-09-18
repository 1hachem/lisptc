# @repo/interpreter

The language, and the extensions that ship with it. Everything in the repo sits
above this package. It depends on no workspace package that depends on it, and
it carries no vendor SDK: `@repo/mcp` and `@repo/llm` hold theirs so this one
never has to. `pnpm check:arch` fails if the MCP SDK or a langchain package
appears in this manifest.

Turbo tag: `language`.

## Shape

`src/lisp.ts` is the language. The reader, the evaluator, the `Interp` a driver
runs, the `InterpExtension` shape an extension satisfies, and `prelude`, the
standard library written in the dialect itself. Both drivers live here too: the
synchronous pair and the asynchronous pair. A change to evaluation is a change
to this file.

`src/session.ts` is the seam. It declares `SessionHooks`, the chains an
extension hooks, the annotation lanes, and `slot`, which mints a capability key.
Read the hook names there, never from prose.

`src/hooks.ts` holds the chain machinery the seam is built on. `src/channels.ts`
and `src/channels-host.ts` carry addressed output. `src/arith.ts`,
`src/plist.ts`, `src/async.ts` and `src/types.ts` are the small supporting
modules. `src/source.ts` holds the language reference the model reads.

`src/extensions/` holds one directory per extension that ships with the
language: `compaction`, `memory`, `promises`, `prose`, `secrets`, `ui`. Each is
the same three files, and a new extension is those three files too:

- `<name>.ts`, the extension and its host interface.
- `<name>-host.ts`, the implementations and the default host value.
- `<name>.ptc`, the prompt, written in the dialect.

`src/core.ptc` is the core prompt beside them.

## Host ports

An extension reaches the world only through an interface it declares itself.
The filesystem, the environment, the network, a subprocess, the clock and its
own prompt all go through one field of that interface.

- `<name>.ts` declares the host interface, one field per port, and takes it as
  its first argument. It imports no `node:` builtin, no typed env module, no
  vendor SDK, and never touches `process.env`. What it cannot reach, it cannot
  hard-code.
- `<name>-host.ts` sits beside it, holds the implementations, and exports the
  default host value. It is the only file of the pair that touches the world.
- The default arrives as a default argument, so the ordinary call passes
  nothing and another strategy is one spread away.
- A port two packages share and neither owns lives in `@repo/shared/host`, with
  its node-side implementation in `@repo/shared/host-node`.
- A port whose work may have to wait is typed so a value or a promise both
  satisfy it, and the extension consumes it through the evaluator's own
  suspension rather than through `async`. A synchronous host then never
  suspends, and the synchronous drivers keep running it.

`check:arch` enforces the first bullet and names the `-host.ts` to move the
offending import to. Type-only imports are allowed, so a port may still be
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
  hook the points in `SessionHooks`. A driver runs a chain with a base case and
  never asks who is on it, so give every new chain a base that is correct when
  nobody hooks it. A REPL built without this extension will take that base.
- A capability goes through a slot. `slot` mints a key, the extension fills it,
  the consumer reads it, and neither imports the other's module. Put a slot
  beside the contract it hands over, which may be a module separate from the
  extension so that consuming the capability does not pull in what provides it.
  `memorySlot` and `secretsSlot` are the examples.
- Data goes through an annotation. A step reports what it did in bags of string
  keys, split by audience and by nothing else. The extension picks the key and
  owns the shape.

Needing something new is never a reason to import across the seam. A new point
in the lifecycle is a new chain. A new capability is a new slot. A new thing to
report is a new key. A payload a layer above would have to interpret belongs
below the seam instead: move the interpretation into the extension.

## Tests

`test/helpers.ts` builds the interpreters. Use `freshInterp`, `proseInterp` and
the `ev` family rather than assembling an `Interp` by hand, so a test picks up
the extension set the helpers keep current. Fixtures for the import forms live
in `test/fixtures/`.

```bash
pnpm --filter @repo/interpreter exec vitest run test/macros.test.ts
pnpm --filter @repo/interpreter exec vitest run -t "name of test"
```
