import type { ChatMessage } from "@repo/shared/messages";

export interface TraceContext {
	threadId: string;
	distinctId?: string;
	sessionId?: string;
	turnId: string;
	provider?: string;
	model?: string;
}

export interface RequestContext {
	distinctId?: string;
	sessionId?: string;
	properties?: Record<string, unknown>;
}

interface Timed {
	trace: TraceContext;
	name: string;
	latencyMs: number;
	failed: boolean;
	error?: string;
	attributes?: Record<string, unknown>;
}

export interface TurnRecord extends Timed {
	content?: { prompt: string; answer: string };
}

export interface SpanRecord extends Timed {
	content?: { input: string; output: string };
}

export interface TokenUsage {
	input?: number;
	output?: number;
	cachedInput?: number;
}

export interface GenerationRecord extends Timed {
	provider?: string;
	model?: string;
	usage?: TokenUsage;
	content?: { input: readonly ChatMessage[]; output: string };
}

export interface ExceptionRecord {
	error: unknown;
	trace: Partial<TraceContext>;
	properties: Record<string, unknown>;
}

export interface Tracer {
	turn(record: TurnRecord): void;
	span(record: SpanRecord): void;
	generation(record: GenerationRecord): void;
	exception(record: ExceptionRecord): void;
	withRequest<T>(context: RequestContext, run: () => T): T;
	flush(): Promise<void>;
}

export interface TracingOptions {
	privacy: boolean;
}

const REDACTED = "[redacted]";

function contentless<T extends { content?: unknown }>(record: T): T {
	return { ...record, content: undefined };
}

function frames(stack: string | undefined): string[] {
	return (stack ?? "").split("\n").filter((line) => /^\s+at /.test(line));
}

function messageless(error: unknown): Error {
	const hidden = new Error(REDACTED);
	if (!(error instanceof Error)) return hidden;
	hidden.name = error.name;
	hidden.stack = [`${error.name}: ${REDACTED}`, ...frames(error.stack)].join(
		"\n",
	);
	return hidden;
}

export function tracing(
	tracers: readonly Tracer[],
	{ privacy }: TracingOptions,
): Tracer {
	const shown = <T extends { content?: unknown }>(record: T): T =>
		privacy ? contentless(record) : record;
	return {
		turn(record) {
			for (const tracer of tracers) tracer.turn(shown(record));
		},
		span(record) {
			for (const tracer of tracers) tracer.span(shown(record));
		},
		generation(record) {
			for (const tracer of tracers) tracer.generation(shown(record));
		},
		exception(record) {
			const seen = privacy
				? { ...record, error: messageless(record.error) }
				: record;
			for (const tracer of tracers) tracer.exception(seen);
		},
		withRequest<T>(context: RequestContext, run: () => T): T {
			return tracers.reduceRight<() => T>(
				(inner, tracer) => () => tracer.withRequest(context, inner),
				run,
			)();
		},
		async flush() {
			await Promise.all(tracers.map((tracer) => tracer.flush()));
		},
	};
}

export const untraced: Tracer = tracing([], { privacy: true });
