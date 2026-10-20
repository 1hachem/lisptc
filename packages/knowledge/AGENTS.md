# @repo/knowledge-extension

The workspace's knowledge files as a language surface: what the user uploaded,
read and written by the agent.

Turbo tag: `extension`.

## Shape

`src/knowledge.ts` is the extension, `src/ports.ts` the contracts a host
satisfies, `src/knowledge-host.ts` the host a root passes in,
`src/knowledge.ptc` the prompt.

## Rules

Read the host-port and seam rules in `packages/interpreter/AGENTS.md`. They
govern this package.

A form that changes or removes a file the user holds is in the extension's
`asks`, so it waits on a human unless a rule says otherwise. So is a form that
reaches the network, and it reaches it only through the host's downloader.

The bin is where a file lands before anyone decided to keep it: what the user
attaches to a message, and what the agent writes or fetches there. It expires.
Only keeping a file moves it into knowledge.

How a file is read back is decided by its extension, one loader per format.
Reading a new format means adding a loader, never a branch in the read form.

## Tests

`test/`. A test installs this extension and no other.
