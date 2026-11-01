# Lisptc Constitution

## Core Principles

### I. Language Parity

Anything the user can do through the UI, the agent MUST be able to do through the language.
A destructive or sensitive action MUST wait on the user's permission before it runs, whichever
way it was asked for.

A spec that adds a UI action MUST add the form that does the same, and say whether it waits on
permission.

Rationale: the agent is the user's hands. An action the agent cannot take is one it can only
describe, and a destructive one it can take unasked is one the user cannot trust.

## Governance

This constitution overrides any spec or plan that contradicts it. An amendment is made with
`/speckit-constitution`, and bumps the version: MAJOR for removing or redefining a principle,
MINOR for adding one, PATCH for wording. Every spec and plan is checked against it before
`/speckit-plan` completes.

**Version**: 1.0.0 | **Ratified**: 2026-11-01 | **Last Amended**: 2026-11-01
