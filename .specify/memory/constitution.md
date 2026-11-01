# Lisptc Constitution

## Core Principles

### I. No Learning Curve

The user MUST never have to learn the UI to get something done. For every user task:

- The agent MUST be able to do it through the language.
- The agent MUST be able to show the user how to do it themselves: bring the place where it is
  done into view and point at the control that does it. So every user task MUST have a UI
  control.

A user task is a change the user can want to what they see or own. These are not user tasks:

- The agent's own work: its plan and todos, the views it renders, reading definitions,
  bounding output, asynchrony.
- The user's side of the conversation: sending, queueing, stopping a turn, rating a reply.

What happens on the user's own device, such as a download or a desktop app control, the agent
MUST be able to show and need not be able to do.

A destructive or sensitive action MUST wait on the user's permission before it runs, whichever
way it was asked for.

A spec that adds a user task MUST add the form that does it, the UI control that does it, and
the way the agent shows that control. It says whether the task waits on permission.

Rationale: the agent is the user's hands and their guide. A task the agent cannot do is one it
can only describe. A task it cannot show is one the user has to hunt for. A destructive one it
can do unasked is one the user cannot trust.

## Governance

This constitution overrides any spec or plan that contradicts it. An amendment is made with
`/speckit-constitution`, and bumps the version: MAJOR for removing or redefining a principle,
MINOR for adding one, PATCH for wording. Every spec and plan is checked against it before
`/speckit-plan` completes.

**Version**: 1.1.0 | **Ratified**: 2026-11-01 | **Last Amended**: 2026-11-01
