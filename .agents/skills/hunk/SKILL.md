---
name: hunk
description: Work with the user in a live Hunk session, in one of two modes. Review mode - listen to the notes the user writes and act on each one as it lands, replying on the note itself. Walkthrough - walk the user through a change one stop at a time, moving their view and lighting up the code each stop is about. Use when the user asks for review mode, to watch or work through their Hunk notes, or to be walked through or shown changes in Hunk. The hunk-review skill is the reference for every hunk session command named here.
---

# hunk

The user reads in Hunk. The terminal is not where they are looking, so what
you say about the code goes on the code: a note, a highlight, a move of their
view. This skill says what to do in each mode. The `hunk-review` skill holds the
syntax of every `hunk session` command it names; read it there.

## Picking the session

`hunk session list`. One session in this checkout is picked on its own. With
several, ask which, and pass its id to every command. A session in another
checkout is never picked: with none here, ask the user to open one. Never run
`hunk diff` or `hunk show` yourself, and never reload a session the user did
not ask you to reload.

## Review mode

The user writes notes. You work through them as they land, and every answer
goes back on the note it belongs to.

### Start

1. Arm the watcher with the Monitor tool, `timeout_ms` at its maximum:

   ```bash
   .agents/skills/hunk/watch-notes.sh [session-id]
   ```

   Each user note without a reply from you arrives as one JSON line,
   `{"event":"note",...}`. A note is handled once you reply on it, so reply
   last, after the work is done. Re-arming sends every unanswered note again.
2. Say in one line that review mode is on, then wait.

When the monitor expires, re-arm it. On `session-gone`, stop, and say so. A
`retrying` line is a failed lookup on a session that is still live; the watcher
keeps going on its own, so ignore it unless it repeats.

### Each note

Read the note, its file and line, and the code around it before deciding. Then
it is exactly one of these:

- **A question.** Answer it with a reply on the note. Answer from the code,
  with file:line anchors in the rationale.
- **A change to make.** Make it. Hold it to every rule in `AGENTS.md` and the
  package's own `AGENTS.md`. Check it with the tests and the typecheck of the
  package it touches, through the `script` agent. Then reply `Done: <what
  changed>` on the note, naming the files.
- **Unclear, or a choice that is the user's.** Do nothing yet. Reply with the
  question on the note. Their answer arrives as a new note in the same thread.

A reply the user writes under one of your notes is a new note like any other.
Read the thread it belongs to before acting on it.

If a fix fails its checks and you cannot get it green, say so on the note with
the failure, and leave the change in the tree for the user to see.

### Rules

- Notes are handled in the order they arrive. Several arriving together are
  answered in one batch.
- Keep a summary to one sentence. The detail goes in the rationale.
- Do not commit or push. The user commits when they say the review is done.
- Do not clear, remove or edit the user's notes.
- A patch session shows the diff it was opened on, so a fix does not appear in
  it. Never reload the session to make it appear; the `Done` reply is the
  record.

## Walkthrough

The user wants to read a change with you steering. All the thinking happens
once, up front: you write the whole walk as a plan, and `walk.sh` loads it.
From then on, every move is one command that runs without you.

### Write the plan

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

Print what the script printed, and say how to move on: `/hunk-next`,
`/hunk-prev` and `/hunk-go <stop>`, which the `hunk-walk` plugin under `.agents/plugins/` answers
without a model call, or "next", "prev" or "go 5" to you.

### Each stop

When the user says next, prev, or names a stop, run the matching
`walk.sh next`, `walk.sh prev` or `walk.sh go <n>`, and print its output as
it is. Write nothing else. The script clears the marks, moves the view, lights
up the stop's `mark` and prints its `say`.

A question the user asks mid-walk is answered in the terminal and, when it
says something the notes should keep, as a reply on that stop's note.

### Rules

- Mark exactly one range at a time, the one under discussion. `walk.sh`
  already does this.
- Leave the notes in place when the walk ends; they are the record of it.
- The walk changes nothing in the tree. A change the user asks for mid-walk is
  made as in review mode, and the walk resumes where it stopped.
