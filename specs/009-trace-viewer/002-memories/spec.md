# Feature Specification: Memories in the Trace Viewer

**Created**: 2026-11-01

**Status**: Draft

**Input**: Moved from `specs/010-context/002-progressive-disclosure/003-internal-knowledge`: "the trace viewer should show the output and input of the judge model, the probabilities, the state that was passed to the judge, the memory choices", and "internal memories should have a gold color in the trace viewer, special kind of memory".

## Context

Internal memories and the judge decide what the agent sees mid-run. Authors tune judged descriptions and find wrong loads by reading what loaded at each step and why. Load events and judge runs are recorded as defined in `specs/010-context/002-progressive-disclosure/003-internal-knowledge`.

## Clarifications

### Session 2026-11-01

- Internal memories → gold, with an internal label, wherever they appear.
- Judge → its input state, raw output, probabilities, threshold and choices, at every step.

## User Scenarios & Testing *(mandatory)*

Actor: the **author**, reading a run to tune the agent.

### User Story 1 - See what loaded and why (Priority: P1)

**Why this priority**: Without it, a wrong or missing load cannot be traced.

**Independent Test**: Open an eval run. Each step lists its load events with key, owner, cause and text.

**Acceptance Scenarios**:

1. **Given** a step where a memory was pointed to or held back, **When** the author opens it, **Then** the reason is shown.
2. **Given** a memory loaded again after compaction, **When** the author reads the run, **Then** both loads show at their own steps.

---

### User Story 2 - Tell internal memories apart (Priority: P1)

**Why this priority**: Internal and workspace memories are tuned by different people.

**Independent Test**: A step where both kinds load shows the internal one in gold with an internal label, and the workspace one without.

**Acceptance Scenarios**:

1. **Given** an internal memory among the judge's candidates, **When** the author opens the step, **Then** it is gold and labelled there too.

---

### User Story 3 - Inspect the judge (Priority: P1)

**Why this priority**: The judge's choices are the main thing authors tune.

**Independent Test**: For any step, an author explains why each memory did or did not load without rerunning it.

**Acceptance Scenarios**:

1. **Given** a step where the judge picked nothing or failed, **When** the author opens it, **Then** its run is shown, a failure next to the input that caused it.

---

### Edge Cases

- A step with no memory activity: its judge run still shows.
- An author who cannot tell gold apart: the internal label carries the kind.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Every load event MUST show at its step: key, owner, cause (judge, trigger or recall), and full text, or for a pointer or hold-back, the reason.
- **FR-002**: Internal memories MUST show in gold with an internal label wherever they appear: load events, judge candidates and choices. Workspace memories MUST NOT use gold.
- **FR-003**: Every step MUST show its judge run, including runs that picked nothing or failed: the state passed in, the candidates with their judged descriptions, the raw output, each memory's probability, the threshold, and each choice (loaded, pointer, held back, below threshold).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of load events in an eval run show at the right step with key, owner, cause and text, internal ones in gold.
- **SC-002**: 100% of steps show the judge run, enough to explain each choice without rerunning.

## Assumptions

- Load events and judge runs are recorded by the memory system; this spec only shows them.
