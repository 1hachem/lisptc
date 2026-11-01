# Feature Specification: Sub-agent Abilities

**Feature Branch**: `010-context/003-sub-agents`

**Created**: 2026-11-01

**Status**: Draft

**Input**: User description: "sub agents should have a list of abilities attached to them, these are the core abilities, but some other abilities can be optional, for example ui and we can toggle it on/off for a subagent, it has a default value for subagents for examle for ui its off, and if a subagent needs to use ui the it the main agent needs to add the toggle ui as flag in the subagent defintion, this will load the system prompt card as well as the internal memories and the install the extension to the repl of the sub agent"

## Context

A sub-agent's extensions are fixed today: it never gets agents, workspace, preferences or ui, and always gets the rest. A delegated task cannot ask for views, and cannot drop tools or secrets it does not need. What an ability is, and which extensions are core or optional, is owned by `specs/006-workspaces/003-abilities`.

## Clarifications

### Session 2026-11-01

- Sub-agent defaults: off → ui, workspace, agents, preferences, secrets, knowledge. On → mcp, llm.
- Grant → the main agent may turn on any optional ability the workspace has not switched off.
- Timing → set at spawn, fixed for the sub-agent's life.
- Q: If a workspace switched an ability off, can the main agent still switch it on for a sub-agent? → A: No. Off in the workspace means off for its sub-agents too.
- Q: Does a sub-agent's own sub-agent inherit its toggles? → A: No. It starts from the defaults plus its own toggles.
- Q: When a definition and a spawn call disagree about an ability, which wins? → A: Neither: toggles live in definitions only. To change a sub-agent's abilities, the main agent updates its definition.

## User Scenarios & Testing *(mandatory)*

Actors: the **main agent** (defines and spawns sub-agents), the **sub-agent**.

### User Story 1 - Turn on an ability (Priority: P1)

The main agent adds `ui` to a sub-agent's definition. The sub-agent gets the ui forms, the ui card and the ui internal memories.

**Why this priority**: It is the feature.

**Independent Test**: Spawn one sub-agent with ui on and one without. The first shows a view. The second has no ui forms, card or memories.

**Acceptance Scenarios**:

1. **Given** a definition with an ability on, **When** the sub-agent spawns, **Then** the extension is installed, its card is in the system prompt, and its internal memories are available.
2. **Given** a definition with a default-on ability turned off (mcp), **When** the sub-agent spawns, **Then** none of the three are present.

---

### User Story 2 - Defaults keep sub-agents lean (Priority: P1)

**Why this priority**: Most delegated work needs no views, settings or secrets.

**Independent Test**: A sub-agent spawned with no toggles carries core plus mcp and llm, nothing else.

**Acceptance Scenarios**:

1. **Given** a definition with no toggles, **When** the sub-agent spawns, **Then** each ability takes its default.

---

### User Story 3 - The main agent knows what it can toggle (Priority: P2)

**Why this priority**: An ability the main agent does not know about is never turned on.

**Independent Test**: Asked to delegate a task that needs a view, the main agent turns ui on without being told the name.

**Acceptance Scenarios**:

1. **Given** a definition toggling an unknown or core name, **When** the main agent saves it, **Then** it is refused with the optional abilities and their defaults.
2. **Given** a sub-agent needs an ability its definition lacks, **When** the main agent wants to spawn it, **Then** it updates the definition first.

---

### Edge Cases

- A sub-agent with agents on spawns its own: toggles are not inherited. The grandchild starts from defaults plus its own toggles.
- The agents ability at the depth cap: spawning is still refused.
- An ability grants forms, not approval: permissions still gate every call.
- A definition is updated while a sub-agent spawned from it runs: the running one keeps its abilities.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Each optional ability MUST have a sub-agent default, as listed in Clarifications.
- **FR-002**: A sub-agent definition MAY toggle any optional ability on or off. A spawn call MUST NOT set abilities. The main agent MUST be able to update a definition's toggles.
- **FR-003**: An ability on or off MUST have the effect defined in `specs/006-workspaces/003-abilities`, in the sub-agent's REPL, system prompt and memories.
- **FR-004**: An untoggled ability MUST take its sub-agent default.
- **FR-005**: An ability the workspace switched off MUST be off for every sub-agent in it, whatever the sub-agent default or toggle. Any other optional ability MAY be turned on.
- **FR-006**: Abilities MUST be fixed at spawn.
- **FR-007**: A definition toggling an unknown or core ability MUST be refused when saved. A spawn whose definition turns on an ability the workspace switched off, or one the composition root cannot provide, MUST fail. Both MUST list the optional abilities and their defaults.
- **FR-008**: Toggles MUST NOT be inherited by a sub-agent's own sub-agents.
- **FR-009**: The agents extension's card or internal memories MUST tell the main agent which abilities exist and their sub-agent defaults.

### Key Entities

- **Toggle**: An ability name set on or off in a sub-agent definition.
- **Sub-agent definition**: The named, reusable description of a sub-agent. Now carries toggles.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A sub-agent with no toggles has a system prompt no longer than today's sub-agent prompt.
- **SC-002**: In 100% of spawns with an ability on, the sub-agent can call its forms from its first step. In 100% without it, they are undefined.
- **SC-003**: 100% of invalid toggles are refused, at save or at spawn, with the list of abilities.

## Assumptions

- Sub-agent defaults are set by the composition root.
- Cards and internal memories follow `specs/010-context/002-progressive-disclosure/003-internal-knowledge`.
