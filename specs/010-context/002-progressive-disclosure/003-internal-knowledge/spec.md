# Feature Specification: Internal Memories

**Feature Branch**: `010-context/002-progressive-disclosure/003-internal-knowledge`

**Created**: 2026-11-01

**Status**: Draft

**Input**: User description: "progressive disclousure for extensions internal working, each extension ships alot of text in its system prompt, and this is all used in the overall system prompt, in the future new extensions will be added that are not necessarly used by all agents, or users, also system prompt at the beginning is not always a good context for immediate actions since llms are influnced more with new tokens, so having the skill prompt loaded just in the right time the agent needs it is better". Follow-up: "the idea is to use the memory system in order to hook prompt about how to use the memories, so each memory comes with a set of memories that are written in lisp (use a .ptc file to write these memories next to the extension)"

## Context

Every turn's system prompt carries the full language reference (319 non-blank lines) and every installed extension's prompt (779 lines over 17 extensions), used or not, and far from where the agent acts. Memory triggers fire after a form runs, too late to teach it. This feature moves that know-how into internal memories that a judge loads just before the agent needs them.

## Clarifications

### Session 2026-11-01

- Scope → extension prompts, the core language reference, and memory's own prompt.
- Always-on → one short summary card per owner.
- Name → internal memories, because they explain internal mechanisms.
- Loading → a judge in the memory extension foresees the need from a memory's `:judged "when the model needs to operate on json"` and loads it first. Replaces an earlier "triggers and recall" answer.
- Internal triggers → an internal memory may load by `:judged`, by any `:on` trigger kind, or by recall, like any memory.
- Internal flag → every internal memory carries an explicit internal flag, in its Lisp form and in every trace.
- Learning → the agent writes judged memories as it learns. A reflection pass after the conversation is future work.
- Loading once → all memories. Within a set distance, a pointer. Beyond it, reload.
- Visibility → hidden from users and the chat body, read-only. Every load and judge run is recorded in the trace. How the trace viewer shows them is owned by `specs/009-trace-viewer/002-memories`.

## User Scenarios & Testing *(mandatory)*

Actors: the **agent** (the model in a session), the **author** (writes the language or an extension), the **workspace user** (chats with the agent, owns the workspace's memories).

### User Story 1 - Know-how arrives before it is needed (Priority: P1)

Before each step, the judge matches where the conversation is heading against judged descriptions and loads what fits. Recall and error triggers still work.

**Why this priority**: Cuts what every turn pays for, and puts instructions where the model weighs them most.

**Independent Test**: "Search my other chats for the redirect loop and tell me what we concluded." The text-handling memories are in context after the chat is read and before the agent filters it.

**Acceptance Scenarios**:

1. **Given** any session, **When** the turn starts, **Then** the system prompt holds only summary cards.
2. **Given** a result the agent must process next, **When** a judged description fits that need, **Then** the memory loads before the next step.
3. **Given** a request that names a need ("parse this JSON"), **When** the turn starts, **Then** the matching memory loads before the first step.

---

### User Story 2 - The language reference shrinks to a card (Priority: P1)

The card keeps only what is needed before any code: forms versus prose, what ends the loop, what is false, `echo`, the names that exist, and how to reach more.

**Why this priority**: It is the largest single block of the system prompt.

**Independent Test**: The full eval suite holds with the language know-how moved.

**Acceptance Scenarios**:

1. **Given** a conversation heading toward an area of the language (numbers, macros, errors), **When** the next step is about to be written, **Then** that area's memory is in context.

---

### User Story 3 - Uninstalled extensions cost nothing (Priority: P1)

**Why this priority**: New extensions, used by some agents only, must not grow every agent's context.

**Independent Test**: A sub-agent given a views task gets nothing from the views extension.

**Acceptance Scenarios**:

1. **Given** extension X is not installed, **When** the judge, a trigger or a recall would pick one of X's memories, **Then** it does not load.
2. **Given** an extension is added to a composition, **When** a session is built, **Then** the system prompt grows by its card only.

---

### User Story 4 - Nothing lands twice (Priority: P1)

**Why this priority**: Without it, the judge and triggers fill the context with copies.

**Independent Test**: One area used at steps 3, 5 and 40. Step 5 gets a pointer. Step 40, past the distance, reloads. After compaction drops step 3, the next need reloads in full.

**Acceptance Scenarios**:

1. **Given** a memory loaded within the distance, **When** it is picked again, **Then** a one-line pointer replaces the copy.
2. **Given** a restored session, **When** a memory loaded before the restore is picked, **Then** it counts as loaded.
3. **Given** a parent agent and a sub-agent, **When** both pick a memory, **Then** each loads it once.

---

### User Story 5 - The agent learns (Priority: P2)

**Why this priority**: Internal memories hold what authors knew. Learning holds what each workspace finds out.

**Independent Test**: The agent hits a wrong tool name and records the fix with a judged description. In a new conversation of the same workspace, the fix loads before the first call to that tool, and the mistake does not repeat.

**Acceptance Scenarios**:

1. **Given** a rejected call, **When** the agent finds the right form, **Then** it records a memory with a judged description.
2. **Given** a description that fired at the wrong moment, **When** the agent notices, **Then** it revises it.

---

### User Story 6 - Memory's own card (Priority: P2)

The card teaches recall and remembering with `:judged`. The rest of memory's prompt becomes internal memories.

**Why this priority**: A card that fails to teach recall cuts the agent off from everything else.

**Independent Test**: The memory evals pass, and another extension's know-how is reachable by recall alone.

**Acceptance Scenarios**:

1. **Given** a session with memory installed, **When** the turn starts, **Then** the card alone lets the agent recall by topic and remember with a judged description.

---

### User Story 7 - Authors write memories beside the code (Priority: P2)

**Why this priority**: Without a clear format, owners keep everything always-on.

**Independent Test**: A memory whose example does not evaluate to its claimed result fails the owner's tests, naming the key.

**Acceptance Scenarios**:

1. **Given** a memory whose body does not read back or that lacks the internal flag, **When** the owner's tests run, **Then** they fail naming the key.
2. **Given** two owners using the same key, **When** a session is composed, **Then** composition fails.

---

### User Story 8 - Users see only their own memories (Priority: P2)

**Why this priority**: Internal know-how must stay stable and out of what users manage.

**Independent Test**: In a workspace at its memory limit, forget all, then run a task. Internal memories still load. The memory view is empty and the chat body shows none.

**Acceptance Scenarios**:

1. **Given** the memory view, the chat body, or a recall the agent shows the user, **When** internal memories were loaded, **Then** none appear.
2. **Given** an internal memory, **When** the agent tries to forget or revise it, **Then** it is refused as built in.

---

### User Story 9 - Fallbacks (Priority: P3)

**Why this priority**: No owner may depend on memory, so know-how must survive without it.

**Independent Test**: Without the memory extension, all know-how is in the system prompt and evals pass. Without a judge, recall and triggers load memories and loading once still applies.

**Acceptance Scenarios**:

1. **Given** no memory extension, **When** the turn starts, **Then** every card and all know-how are in the system prompt.

---

### Edge Cases

- The judge picks more than the step limit: the strongest load, and the agent is told more can be recalled.
- The judge is slow or fails: the step goes ahead without picks.
- An owner is upgraded: the next load serves the new text.
- A learned memory contradicts an internal one: both may load. The learned one is the workspace's correction.
- Internal memories never decay. Learned ones decay as workspace memories do today.
- An owner ships no knowledge file: its full prompt stays always-on.
- The agent tries to remember a memory with the internal flag: refused.

## Requirements *(mandatory)*

### Functional Requirements

**Internal memories**

- **FR-001**: The language and each extension MUST declare a summary card separate from their detailed know-how.
- **FR-002**: Detailed know-how MUST ship as internal memories in Lisp, in a `.ptc` file beside the owning code.
- **FR-003**: An internal memory MUST have a key, a body and the internal flag, and MAY have a judged description, an `:on` trigger of any kind, and links. The flag MUST be written explicitly in the memory's Lisp form, and the agent MUST NOT be able to write a memory with it.
- **FR-004**: An extension's internal memories MUST be available exactly when it is installed. The language's MUST always be.
- **FR-005**: Internal memories MUST be read-only: forget, forget-all and revise refuse or skip them.
- **FR-006**: Internal memories MUST NOT be stored per workspace or count toward its limit.
- **FR-007**: Internal keys MUST NOT collide with workspace keys. Duplicate keys across owners MUST fail composition.
- **FR-008**: Owners MUST NOT depend on the memory extension. Know-how is declared as data.
- **FR-009**: The language reference, memory's prompt and every extension prompt MUST move to a card plus internal memories.
- **FR-010**: Memory's card MUST teach recall and remembering with a judged description.

**Judge**

- **FR-011**: The memory extension MUST include a judge that runs before every step.
- **FR-012**: The judge's input MUST be the user's request, the steps and results so far, the load record, and the judged descriptions of available memories.
- **FR-013**: Any memory, internal or workspace, MAY carry a judged description.
- **FR-014**: Picks MUST be in context before the step they serve.
- **FR-015**: Candidates MUST be limited to internal memories of installed owners and the workspace's own.
- **FR-016**: The composition root MUST hand in the judge's model. Without one, recall and triggers MUST still work.
- **FR-017**: The judge MUST only decide what loads.
- **FR-018**: A step MUST load no more than a set limit, and the agent MUST be told when picks were held back.

**Learning**

- **FR-019**: The agent MUST be able to write and revise workspace memories with judged descriptions mid-conversation.
- **FR-020**: Memory's know-how MUST tell the agent to record a judged memory when a guess fails.

**Loading once**

- **FR-021**: For every memory, a pick within a set distance of its earlier copy MUST give a one-line pointer instead of a second copy.
- **FR-022**: Beyond the distance, or after compaction drops the copy, the memory MUST load again in full.
- **FR-023**: The load record MUST survive restore and be kept per conversation, sub-agents included.

**Visibility**

- **FR-024**: Internal memories MUST NOT appear to the workspace user: memory view, memory count, chat body, or recall and listing output shown to them.
- **FR-025**: The model MUST see internal memories marked built in.
- **FR-026**: Every load event and every judge run, including runs that picked nothing or failed, MUST be recorded in the run's trace, with the internal flag on every internal memory.

**Authoring and roots**

- **FR-027**: Owner tests MUST check each internal memory: the body reads back, the internal flag is present, any trigger is well formed, and examples evaluate to their claimed results.
- **FR-028**: Cards, memory prose and judged descriptions MUST use caveman voice, with forms copied exactly.
- **FR-029**: Without the memory extension, all know-how MUST go into the system prompt.
- **FR-030**: Every composition root (served agent, terminal REPL, MCP REPL, language server, evals) MUST provide internal memories the same way.

### Key Entities

- **Summary card**: An owner's always-on text: purpose, main forms, how to reach more.
- **Internal memory**: Know-how about an internal mechanism of the language or an extension. Belongs to the owner's release. Carries the internal flag. Loads like any memory. Read-only, hidden from users.
- **Workspace memory**: The existing per-workspace memory. May carry a judged description. Learned memories are workspace memories.
- **Judged description**: Plain words on when a memory is needed. The judge reads it.
- **Judge run**: One step's judging: the state passed in, the candidates with their judged descriptions, the raw output, each memory's probability, the threshold, and each choice (loaded, pointer, held back, below threshold).
- **Load event**: One memory loaded, pointed to or held back at a step: key, owner, internal flag, cause (judge, trigger or recall), and its text or the reason.
- **Load record**: What a conversation loaded and at which step.
- **Knowledge file**: The `.ptc` file of an owner's internal memories.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Always-on language and extension text in a root chat falls by at least 60% from 1098 non-blank lines.
- **SC-002**: A new extension adds at most 15 non-blank lines to the always-on prompt.
- **SC-003**: The eval suite passes at least as often as the baseline. No case that always passed fails more than one run in three.
- **SC-004**: The relevant memory is in context before the agent's first step in its area in at least 90% of eval runs.
- **SC-005**: A mistake recorded in one conversation is not repeated in a later one in at least 90% of eval runs built for it.
- **SC-006**: No memory's full text appears twice within the distance in any eval conversation.
- **SC-007**: No step loads more than 120 non-blank lines of memory text.
- **SC-008**: The judge adds at most 10% to median step time.
- **SC-009**: An uninstalled extension's memories appear in context 0 times across the eval suite.
- **SC-010**: 0 internal memories are shown to users, and 0 attempts to forget or revise one succeed.
- **SC-011**: 100% of load events and judge runs in an eval run are recorded in its trace.
- **SC-012**: An author moves one extension to a card plus knowledge file within one working session, touching no other extension.

## Assumptions

- "Each memory comes with a set of memories" means each extension comes with a set of memories.
- The fixed identity and policy text is out of scope.
- Learning stays within a workspace.
- Recall stays keyword based. Only the judge reads meaning.
- Judge runs are recorded, so evals replay deterministically.
- How the trace viewer shows load events and judge runs is owned by `specs/009-trace-viewer/002-memories`.
- The distance and the step limit are set in planning and pinned by tests.
- Which extensions a session installs is owned by `specs/006-workspaces/003-abilities` for main chats and `specs/010-context/003-sub-agents` for sub-agents.
