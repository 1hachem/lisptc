# Feature Specification: Conversation Body

**Input**: User description: "it should show no technical jargon about the internal workings, memories, lisp, ui forms, recovery, in the ui we should eliminate any form of repetition for example currently 2 things show the same "calling x tool" twice on top of each other one for the form and another for the tool calling state, any information should be non redundant deduped, non fatal errors should be hidden and retried, new extension will be added to create a way to test forms and to recover error instantly, add a spec for recovery extension keep it empty for now, recovery communication should be in natural language (tried to call x tool and it failed let me try a different way) for example"

## Requirements

- The body shows no technical jargon about the internal workings: memories, Lisp, UI forms, recovery.
- No repetition. Today one tool call shows twice, one row for the form and one for the tool calling state. It shows once.
- Every piece of information is shown once, deduped.
- Non-fatal errors are hidden and retried.
- Recovery is told in natural language, for example: "I tried to call X tool and it failed, let me try a different way."

## Related

- A new recovery extension gives a way to test forms and recover from errors instantly. Its spec is `specs/021-recovery`, empty for now.
