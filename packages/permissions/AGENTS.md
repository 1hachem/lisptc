# @repo/permissions-extension

What a session may call. Every call is allowed, denied, or waits for a human.

Turbo tag: `extension`.

## Shape

`src/permissions.ts` is the extension, `src/ports.ts` the contracts a host
satisfies, `src/permissions-host.ts` the host a root passes in,
`src/permissions.ptc` the prompt. `src/rules.ts` reads a config, `src/approvals.ts`
holds what was asked and what was granted, and `src/ui-approver.ts` is the one
approver that ships.

## Rules

Read the host-port and seam rules in `packages/interpreter/AGENTS.md`. They
govern this package.

**A config is ptc lisp, and one form is both a line of it and a call.** A store
hands over source text and `parseRules` walks it as data, never evaluating it.
The same `permission/` forms run in a session, and every one reaches the config
through `permission/apply` alone. A new rule is a new form in both places, and
its tests go in beside the others.

**A session never changes its config on its own.** Every `permission/` form that
changes the config, a delete included, waits on an approval like any other asked
call, and is saved through the store once approved. Only a rule that names the
form itself decides otherwise, and the config's default never does. A new
operation goes through the same gate in `permission/apply`.

**Ask is three parts, and only an approver knows how a human is reached.**
`Approvals` is the state and the only place a decision lands. An `Approver`
delivers a request and never decides. Every reply path, whatever its transport,
ends at `resolveApproval`. A new way to reach a human is a new `Approver`, never
a branch in the guard.

Where a config is kept, and who may write it, is the host's decision, never this
package's.

`PermissionRules` satisfies the MCP extension's policy port by shape. A root
hands the same rules to both, and this package imports nothing from that one.

## Tests

`test/`. A test installs this extension and no other.
