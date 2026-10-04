# @repo/workspace-extension

The workspace extension. A workspace is a git repository of .ptc files laid
out by convention, and what the agent saves into it loads in every later
session. Saving and loading are this package's surface. Where the files live
and how history is kept are not.

Turbo tag: `extension`.

## Shape

`src/workspace.ts` is the extension, `src/ports.ts` the convention and the
contracts a host satisfies, `src/workspace-host.ts` the disk-and-git host a
root passes in, `src/workspace.ptc` the prompt.

## Rules

Read the host-port and seam rules in `packages/interpreter/AGENTS.md`. They
govern this package.

The layout is named once, in `src/ports.ts`. A path the convention adds is a
constant there and an entry in the load order, never a string in a form.

Only an explicit save writes a file. Evaluating a definition records it and
nothing more, so scratch work never lands in the repository.

A file is one definition, and a save rewrites only the file it names, so a
human's edits to every other file survive.

Files and history are ports. Nothing outside `src/workspace-host.ts` reads the
disk or runs git, so a host with no disk can satisfy both.

## Tests

`test/`. A test installs this extension and no other, against a fresh
workspace in a temp directory.
