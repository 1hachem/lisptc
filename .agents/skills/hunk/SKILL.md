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

The user wants to read a change with you steering. You choose the stops, put
them on the code, and move their view from one to the next.

### Lay out the stops

1. Read the session's file and hunk structure, never its whole patch. Read the
   files themselves for the lines you anchor to.
2. Order the stops as the change tells its story, not in file order: where a
   request or a value enters, what carries it, where it ends up, then the tests
   that pin it.
3. Pick the stops the user would not find alone: a decision, a seam, the line
   that fixes the bug. Leave out generated files, lockfiles and plain renames.
   Keep to about a dozen.
4. Put every stop on the code in one batch of notes, each anchored to the new
   line of the declaration it is about. A summary is one sentence, starting
   with its place in the walk (`3/12`). The detail goes in the rationale.
5. Move the view to stop 1 and mark the name it is about with the `current`
   tone.

Then list the stops in the terminal, one line each with its file:line, and say
how to move on: the user's own next-comment key in Hunk, or "next" to you.

### Each stop

When the user says next, or names a stop:

1. Clear the marks.
2. Mark the name the stop is about with the `current` tone, with the view
   focused on it.
3. Say in the terminal what that code does, in a few lines, without repeating
   the note.

A question the user asks mid-walk is answered in the terminal and, when it
says something the notes should keep, as a reply on that stop's note.

### Rules

- Mark exactly one range at a time, the one under discussion.
- Leave the notes in place when the walk ends; they are the record of it.
- The walk changes nothing in the tree. A change the user asks for mid-walk is
  made as in review mode, and the walk resumes where it stopped.
