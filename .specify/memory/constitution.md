# Lisptc Constitution

## Core Principles

### I. Small Models First

Lisptc MUST be able to run, in the end, on small open-source models that run locally. A design
MUST NOT depend on what only a frontier model can do: long reliable reasoning, a large context
read in full, or a free-form answer that is right the first time.

Where a small model falls short, the system MUST carry the load instead of the model:

- A narrow, checkable form over a free-form answer.
- Context handed over just when it is needed, not all of it up front.
- An error caught and retried or recovered by the system, not explained away by the model.
- A reused artifact over a new chain of thought (see II).

A spec that relies on the model MUST say what a small model gets wrong there, and how the system
makes up for it.

Rationale: a local small model is cheap, private and always there. It only works if the system
around it does the part it cannot.

### II. Intelligence Mints Artifacts

Model intelligence is spent to make artifacts, and artifacts are what get reused. An artifact is
a procedure or workflow, a memory, a piece of knowledge, or a UI.

- When the agent works something out, it MUST be able to keep the result as an artifact.
- When a task matches an artifact, the agent MUST reuse the artifact rather than think it
  through again.
- Reusing an artifact MUST need no more than a small model's flexibility: picking it, filling
  it in, adapting it. It MUST NOT need fresh reasoning.

A spec that adds a kind of work MUST say which artifact that work leaves behind, and how it is
found and reused.

Rationale: thinking tokens are the expensive part. Paid once to mine an artifact, they are not
paid again. That is also how a small model does a job a large one first figured out.

### III. Language-UI Parity

Every user task MUST be doable both ways:

- The agent MUST be able to do it through the language.
- The agent MUST be able to show the user how to do it themselves: bring the place where it is
  done into view and point at the control that does it. So every user task MUST have a UI
  control.

A user task is a change the user can want to what they see or own. These are not user tasks:

- The agent's own work: its plan and todos, the views it renders, reading definitions,
  bounding output, asynchrony.
- The user's side of the conversation: sending, queueing, stopping a turn, rating a reply.

These user tasks are the user's alone, through the UI only. The agent MUST NOT be able to do
them, and MAY show the user where they are done:

- Creating a workspace.
- Deleting the account, or changing its information.
- Changing billing information.
- Signing in and signing out.

What happens on the user's own device, such as a download or a desktop app control, the agent
MUST be able to show and need not be able to do.

A destructive or sensitive action MUST wait on the user's permission before it runs, whichever
way it was asked for.

A spec that adds a user task MUST add the form that does it, the UI control that does it, and
the way the agent shows that control, unless the task is one of the user's alone. It says
whether the task waits on permission.

Rationale: the agent is the user's hands and their guide. A task the agent cannot do is one it
can only describe. A task it cannot show is one the user has to hunt for. A destructive one it
can do unasked is one the user cannot trust. The tasks kept from it are the ones that decide who
the user is and what they pay, which no agent needs to touch.

### IV. Malleable, Safely

The user MUST be able to shape Lisptc to what they need, as far as it can safely go: their
procedures, memories, knowledge, views and preferences. A thing the agent can make, the user
MUST be able to change, keep or remove.

Shaping MUST stay safe:

- A change MUST reach only what the user owns.
- A change MUST NOT get past the permissions of III.
- A change that breaks something MUST be undoable.

Rationale: software that bends to its user fits more jobs than any fixed design. It is only worth
it if bending it never puts the user's data or account at risk.

### V. No Learning Curve

The user MUST never have to learn the product before using it.

- Lisptc opens on a chat input. Natural language is the way in, and the user already knows it.
- A screen MUST show the least that gets the job at hand done. Anything more waits until it is
  asked for or needed.
- The agent MUST onboard the user as they go: it tells them how to use a part of the product
  when their need reaches that part, and not before.

A spec that adds something to a screen MUST say why the job needs it there, and what is hidden
until later.

Rationale: every extra thing on screen is load on the user's attention. A product learned one need
at a time is learned without a manual.

## Governance

This constitution overrides any spec or plan that contradicts it. An amendment is made with
`/speckit-constitution`, and bumps the version: MAJOR for removing or redefining a principle,
MINOR for adding one, PATCH for wording. Every spec and plan is checked against it before
`/speckit-plan` completes.

**Version**: 2.0.0 | **Ratified**: 2026-11-01 | **Last Amended**: 2026-11-04
