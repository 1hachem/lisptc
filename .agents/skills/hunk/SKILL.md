---
name: hunk
description: Work with the user in a live Hunk session. Walk them through a change one stop at a time, moving their view and lighting up the code each stop is about, and listen to the notes they write the whole time, acting on each one as it lands and replying on the note itself. Use when the user asks to be walked through or shown changes in Hunk, to review in Hunk, or to watch or work through their Hunk notes. The hunk-review skill is the reference for every hunk session command named here.
---

# hunk

The user reads in Hunk. The terminal is not where they are looking, so what
you say about the code goes on the code: a note, a highlight, a move of their
view. One session does two things at once: you walk the user through the
change, and you listen to every note they write while you do. This skill says
how. The `hunk-review` skill holds the syntax of every `hunk session` command
it names; read it there.

## Picking the session

`hunk session list`. One session in this checkout is picked on its own. With
several, ask which, and pass its id to every command. A session in another
checkout is never picked: with none here, ask the user to open one. Never run
`hunk diff` or `hunk show` yourself, and never reload a session the user did
not ask you to reload.

## Start

1. Arm the note watcher first, with the Monitor tool, `timeout_ms` at its
   maximum, so nothing the user writes during the walk is missed:

   ```bash
   .agents/skills/hunk/watch-notes.sh [session-id]
   ```

   Each user note without a reply from you arrives as one JSON line,
   `{"event":"note",...}`. A note is handled once you reply on it, so reply
   last, after the work is done. Re-arming sends every unanswered note again.
2. Write the walk plan and load it, as below.
3. Print what `walk.sh load` printed, and say in one line that you are
   listening to notes. Say how to move on: `/hunk-next`, `/hunk-prev` and
   `/hunk-go <stop>`, which the `hunk-walk` plugin under `.agents/plugins/`
   answers without a model call, or "next", "prev" or "go 5" to you.

When the user asks only to have their notes watched, or the session has
nothing worth walking, skip the plan and say in one line that you are
listening.

When the monitor expires, re-arm it. On `session-gone`, stop, and say so. A
`retrying` line is a failed lookup on a session that is still live; the watcher
keeps going on its own, so ignore it unless it repeats.

## The walk plan

All the thinking for the walk happens once, up front: you write the whole walk
as a plan, and `walk.sh` loads it. From then on, every move is one command that
runs without you.

1. Read the session's file and hunk structure, never its whole patch. Read the
   files themselves for the lines you anchor to.
2. Order the stops as the change tells its story, not in file order: where a
   request or a value enters, what carries it, where it ends up, then the tests
   that pin it.
3. Pick the stops the user would not find alone: a decision, a seam, the line
   that fixes the bug. Leave out generated files, lockfiles and plain renames.
   Keep to about a dozen.
4. Write the plan to a JSON file in the scratchpad:

   ```json
   {"stops": [{"file": "packages/x/src/y.ts", "line": 12, "mark": "nameAtLine",
     "summary": "One sentence for the note.", "rationale": "The note's detail.",
     "say": "What the terminal shows at this stop, a few lines."}]}
   ```

   `line` is the new line of the declaration the stop is about, and `mark` is
   the exact text on that line to light up. `summary` leaves out the `3/12`
   prefix, because the script numbers the stops. `say` says what the code does
   without repeating the note.
5. Load it, which puts every note on the code, moves the view to stop 1 and
   prints the list:

   ```bash
   .agents/skills/hunk/walk.sh load <plan.json> [session-id]
   ```

## Each stop

When the user says next, prev, or names a stop, run the matching
`walk.sh next`, `walk.sh prev` or `walk.sh go <n>`, and print its output as
it is. Write nothing else. The script clears the marks, moves the view, lights
up the stop's `mark` and prints its `say`.

A question the user asks in the terminal mid-walk is answered there and, when
it says something the notes should keep, as a reply on that stop's note.

## Each note

A note arrives from the watcher at any point, mid-walk included. Read the
note, its file and line, and the code around it before deciding. Then it is
exactly one of these:

- **A question.** Answer it with a reply on the note. Answer from the code,
  with file:line anchors in the rationale.
- **A change to make.** Make it. Hold it to every rule in `AGENTS.md` and the
  package's own `AGENTS.md`. Check it with the tests and the typecheck of the
  package it touches, through the `script` agent. Then reply `Done: <what
  changed>` on the note, naming the files.
- **Unclear, or a choice that is the user's.** Do nothing yet. Reply with the
  question on the note. Their answer arrives as a new note in the same thread.

A reply the user writes under one of your notes, a walk stop's note included,
is a new note like any other. Read the thread it belongs to before acting on
it.

If a fix fails its checks and you cannot get it green, say so on the note with
the failure, and leave the change in the tree for the user to see.

Handling a note never moves the walk. Do not navigate or highlight for it; the
user's view stays where they put it, and the walk resumes at the stop it was on.

## Rules

- Notes are handled in the order they arrive. Several arriving together are
  answered in one batch.
- Keep a summary to one sentence. The detail goes in the rationale.
- Mark exactly one range at a time, the one under discussion. `walk.sh`
  already does this.
- Do not commit or push. The user commits when they say the review is done.
- Do not clear, remove or edit the user's notes. Leave the walk's notes in
  place when it ends; they are the record of it.
- A patch session shows the diff it was opened on, so a fix does not appear in
  it. Never reload the session to make it appear; the `Done` reply is the
  record.
- The walk itself changes nothing in the tree. Only a note asking for a change
  does.
