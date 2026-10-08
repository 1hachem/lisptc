import type { Awaitable } from "@repo/shared/host";
import { EvalException } from "./errors.ts";
import type { List } from "./objects.ts";

export type Eval<T = unknown> = Generator<Promise<unknown>, T, unknown>;

export function* settled<T>(value: Awaitable<T>): Eval<T> {
	return value instanceof Promise ? ((yield value) as T) : value;
}

export interface Evaluator {
	evalGen(x: unknown, env: List): Eval;
}

export function driveSync<T>(gen: Eval<T>): T {
	let step = gen.next();
	while (!step.done)
		step = gen.throw(
			new EvalException(
				"cannot suspend",
				"this host evaluates synchronously",
				false,
			),
		);
	return step.value;
}

export interface Outcome<T = unknown> {
	value: T;
}

export async function driveAsync<T>(gen: Eval<T>): Promise<Outcome<T>> {
	let step = gen.next();
	while (!step.done) {
		let resumed: unknown;
		try {
			resumed = await step.value;
		} catch (ex) {
			step = gen.throw(ex);
			continue;
		}
		step = gen.next(resumed);
	}
	return { value: step.value };
}

type Decision = { readonly granted: true } | { readonly refusal: unknown };

export class Hold {
	private decision: Decision | undefined;
	private settle!: (decision: Decision) => void;
	readonly until: Promise<void>;

	constructor(readonly reason: string) {
		this.until = new Promise<void>((resolve, reject) => {
			this.settle = (decision) =>
				"granted" in decision ? resolve() : reject(decision.refusal);
		});
	}

	get released(): boolean {
		return this.decision !== undefined;
	}

	release(): void {
		this.decision ??= { granted: true };
	}

	refuse(refusal: unknown): void {
		this.decision ??= { refusal };
	}

	resume(): void {
		if (this.decision !== undefined) this.settle(this.decision);
	}
}

export class Holds {
	private parker: ((hold: Hold) => void) | undefined;

	get parkable(): boolean {
		return this.parker !== undefined;
	}

	parkWith(parker: (hold: Hold) => void): () => void {
		this.parker = parker;
		return () => {
			if (this.parker === parker) this.parker = undefined;
		};
	}

	park(hold: Hold): Hold {
		this.parker?.(hold);
		return hold;
	}
}
