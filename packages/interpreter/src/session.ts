import type { Skipped } from "@repo/shared/lisp-forms";
import type { ChatMessage } from "@repo/shared/messages";
import type { Addressed } from "./channels.ts";
import type { ChannelBuffer } from "./channels-host.ts";
import type { Eval } from "./drive.ts";
import { Chain } from "./hooks.ts";
import type { Installable, Interp } from "./lisp.ts";
export type Bounded = Required<Addressed<string>>;

export type Annotations = Record<string, unknown>;

export interface StepAnnotations {
	readonly step: Annotations;
	readonly output: Annotations;
}

export function noAnnotations(): StepAnnotations {
	return { step: {}, output: {} };
}

export function annotating(
	into: StepAnnotations,
	where: keyof StepAnnotations,
	entry: Annotations,
): StepAnnotations {
	return { ...into, [where]: { ...into[where], ...entry } };
}

export interface TurnContext {
	readonly interp: Interp;
	emit(text: string): void;
}

export interface StepContext {
	readonly interp: Interp;
	readonly code: string;
	emit(text: string): void;
}

export interface StepOutcome extends Bounded {
	readonly skipped: readonly string[];
	readonly failed: boolean;
}

export interface ModelUsage {
	readonly input: number;
	readonly output: number;
	readonly cachedInput?: number;
}

export interface ModelDelta {
	readonly text?: string;
	readonly reasoning?: string;
	readonly usage?: ModelUsage;
}

export interface ModelRequest {
	readonly system: string;
	readonly messages: readonly ChatMessage[];
}

export type StepVerdict = "continue" | "halt" | "capped";

export type TurnOutcome = "halt" | "capped" | "silent" | "failed" | "aborted";

export interface AgentTurn {
	readonly interp: Interp;
	readonly threadId: string;
	readonly turnId: string;
	readonly prompt: string;
	readonly provider: string;
	readonly model: string;
}

export interface AgentStep {
	readonly step: number;
	readonly code: string;
	readonly output: string;
	readonly error: boolean;
	readonly failed: boolean;
	readonly latencyMs: number;
}

export interface AgentFailure {
	readonly message: string;
	readonly error: unknown;
	readonly cancelled: boolean;
}

export interface AgentEnd {
	readonly outcome: TurnOutcome;
	readonly answer: string;
	readonly steps: number;
	readonly latencyMs: number;
	readonly failure?: AgentFailure;
}

export interface ActionContext {
	readonly interp: Interp;
	readonly action: string;
	readonly values: Record<string, unknown>;
}

export interface Slot<T> {
	readonly name: string;
	readonly held?: T;
}

export function slot<T>(name: string): Slot<T> {
	return { name };
}

export interface InterpExtension extends Installable {
	readonly session?: (hooks: SessionHooks) => void;
}

export interface SessionHooks {
	readonly turnStart: Chain<[ctx: TurnContext], Eval<void>>;
	readonly system: Chain<[interp: Interp, prompt: string], Eval<string>>;
	readonly beginStep: Chain<[ctx: TurnContext], Eval<void>>;
	readonly context: Chain<
		[interp: Interp, messages: readonly ChatMessage[]],
		readonly ChatMessage[]
	>;
	readonly modelCall: Chain<
		[interp: Interp, request: ModelRequest],
		AsyncIterable<ModelDelta>
	>;
	readonly response: Chain<[interp: Interp, text: string], string>;
	readonly stepEnd: Chain<
		[turn: AgentTurn, step: AgentStep, verdict: StepVerdict],
		StepVerdict
	>;
	readonly beforeSettle: Chain<
		[ctx: TurnContext, more: boolean],
		Eval<boolean>
	>;
	readonly settled: Chain<[turn: AgentTurn, end: AgentEnd], void>;
	readonly evalStep: Chain<[ctx: StepContext], Promise<void>>;
	readonly stepOutput: Chain<[ctx: StepContext, out: Bounded], Bounded>;
	readonly stepError: Chain<[ctx: StepContext, text: string], Bounded>;
	readonly answered: Chain<[ctx: StepContext, out: StepOutcome], boolean>;
	readonly unrun: Chain<[interp: Interp, code: string], Skipped[]>;
	readonly annotate: Chain<
		[buffer: ChannelBuffer, into: StepAnnotations],
		StepAnnotations
	>;
	readonly message: Chain<[buffer: ChannelBuffer], string | undefined>;
	readonly invoke: Chain<[ctx: ActionContext], Promise<void>>;
	fill<T>(of: Slot<T>, value: T): void;
	filled<T>(of: Slot<T>): T | undefined;
}

export function newSessionHooks(): SessionHooks {
	const slots = new Map<string, unknown>();
	return {
		turnStart: new Chain(),
		system: new Chain(),
		beginStep: new Chain(),
		context: new Chain(),
		modelCall: new Chain(),
		response: new Chain(),
		stepEnd: new Chain(),
		beforeSettle: new Chain(),
		settled: new Chain(),
		evalStep: new Chain(),
		stepOutput: new Chain(),
		stepError: new Chain(),
		answered: new Chain(),
		unrun: new Chain(),
		annotate: new Chain(),
		message: new Chain(),
		invoke: new Chain(),
		fill<T>(of: Slot<T>, value: T): void {
			slots.set(of.name, value);
		},
		filled<T>(of: Slot<T>): T | undefined {
			return slots.get(of.name) as T | undefined;
		},
	};
}

export function openSession(
	extensions: readonly InterpExtension[],
): SessionHooks {
	const hooks = newSessionHooks();
	for (const extension of extensions) extension.session?.(hooks);
	return hooks;
}
