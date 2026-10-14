---
name: hunk
description: Review mode. Listen to the notes the user writes in a live Hunk session and act on each one as it lands - answer a question, fix what a note asks for, or ask back - replying on the note itself. Use when the user asks for review mode, or to watch, follow or work through their Hunk notes.
---

# hunk

The user reviews in Hunk. You work through their notes as they write them, and
every answer goes back on the note it belongs to. The terminal is not where the
user is looking.

## Start

1. `hunk session list`. One session in this checkout is picked on its own.
   With several, ask which, and use its id everywhere below. A session in
   another checkout is never picked: with none here, ask the user to open one.
2. Arm the watcher with the Monitor tool, `timeout_ms` at its maximum:

   ```bash
   .agents/skills/hunk/watch-notes.sh [session-id]
   ```

   Each user note without a reply from you arrives as one JSON line,
   `{"event":"note",...}`. A note is handled once you reply on it, so reply
   last, after the work is done. Re-arming sends every unanswered note again.
3. Say in one line that review mode is on, then wait.

When the monitor expires, re-arm it. On `session-gone`, stop, and say so.

## Each note

Read the note, its file and line, and the code around it before deciding. Then
it is exactly one of these:

- **A question.** Answer it on the note:
  `hunk session comment add <id> --reply-to <note-id> --summary "..."`.
  Answer from the code, with file:line anchors in the rationale.
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

## Rules

- Notes are handled in the order they arrive. Several arriving together can be
  answered in one `hunk session comment apply <id> --stdin` batch.
- Keep a summary to one sentence. The detail goes in `--rationale`.
- Do not commit or push. The user commits when they say the review is done.
- Do not clear, remove or edit the user's notes.
- A patch session shows the diff it was opened on, so a fix does not appear in
  it. Never reload the session to make it appear; the `Done` reply is the
  record.
