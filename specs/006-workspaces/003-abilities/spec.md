# Feature Specification: Workspace Abilities

**Feature Branch**: `006-workspaces/003-abilities`

**Created**: 2026-11-01

**Status**: Draft

**Input**: Split from `specs/010-context/003-sub-agents`: "the main chat will have optional abilities that can turn on and off, per workspace, currently all extensions are on by default but later on new extensions will be added on specific usecase only"

## Context

A main chat carries every extension in every workspace, so an extension built for one use case would cost every workspace.

## Clarifications

### Session 2026-11-01

- Ability → an optional extension. On means installed in the agent's REPL, its card in its system prompt, and its internal memories available.
- Core, always on → permissions, promises, introspection, compaction, memory, intent, prose, diagnostics, and the sub-agent's export forms.
- Optional → ui, workspace, agents, preferences, secrets, knowledge, mcp, llm.
- Q: Should main chats have optional abilities? → A: Yes, toggled per workspace. Every current extension defaults on; extensions added later for specific use cases may default off.
- Q: Who can switch a workspace's abilities? → A: The user from the settings panel, and the agent through the language. The agent's change waits on the user's approval, like other settings.

## User Scenarios & Testing *(mandatory)*

Actors: the **workspace user**, who toggles abilities from the settings panel; the **agent** in the workspace's main chat.

### User Story 1 - A workspace picks its main chat's abilities (Priority: P1)

**Why this priority**: Extensions built for one use case must not cost every workspace.

**Independent Test**: Turn ui off in one workspace. Its main chat has no ui forms, card or memories from the next turn. Another workspace still has ui.

**Acceptance Scenarios**:

1. **Given** a workspace toggles an ability, **When** the next turn starts, **Then** the main chat has or lacks all three accordingly.
2. **Given** the agent asks to turn an ability on, **When** the user has not approved, **Then** nothing changes.
3. **Given** a new extension that defaults off, **When** a workspace has not turned it on, **Then** its main chats lack it.

---

### Edge Cases

- A workspace turns the workspace ability off: the agent can no longer change settings, and the user still can from the settings panel.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Every extension MUST be either core or optional, as listed in Clarifications. Each optional ability MUST have a main-chat default.
- **FR-002**: An ability on MUST install the extension in the agent's REPL, put its card in its system prompt, and make its internal memories available. Off MUST do none of the three.
- **FR-003**: A workspace's abilities MAY be toggled by the user from the settings panel, or by the agent through the language. The agent's change MUST wait on the user's approval. A change MUST apply from the next turn.
- **FR-004**: Every current extension MUST default on for main chats. An extension added later MUST declare its main-chat default.
- **FR-005**: The agent MUST be able to read which abilities the workspace has on and off.

### Key Entities

- **Ability**: An optional extension, with a main-chat default.
- **Workspace abilities**: A workspace's on or off choice for each optional ability.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: In 100% of workspaces that turn an ability off, the next main-chat turn has none of its forms, card or memories.
- **SC-002**: A main chat with every optional ability off carries only core cards in its system prompt.

## Assumptions

- Which extensions are optional, and their defaults, is set by the composition root. A workspace only toggles them.
- Abilities per user are out of scope.
- Cards and internal memories follow `specs/010-context/002-progressive-disclosure/003-internal-knowledge`.
- Sub-agent abilities follow `specs/010-context/003-sub-agents`.
