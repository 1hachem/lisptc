import type { Awaitable } from "@repo/shared/host";
import { EvalException } from "./errors.ts";
import { hitch, type Journal, released } from "./journal.ts";
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

	constructor(
		readonly id: string,
		readonly reason: string,
		private readonly decided: (granted: boolean) => void,
	) {
		this.until = new Promise<void>((resolve, reject) => {
			this.settle = (decision) =>
				"granted" in decision ? resolve() : reject(decision.refusal);
		});
	}

	release(): void {
		if (this.decision !== undefined) return;
		this.decision = { granted: true };
		this.decided(true);
	}

	refuse(refusal: unknown): void {
		if (this.decision !== undefined) return;
		this.decision = { refusal };
		this.decided(false);
	}

	resume(): void {
		if (this.decision !== undefined) this.settle(this.decision);
	}
}

export class Holds {
	parkable = false;
	private issued = 0;
	private readonly open = new Map<string, Hold>();

	park(reason: string, journal: Journal): Hold {
		this.issued += 1;
		const id = `hold-${this.issued}`;
		const hold = new Hold(id, reason, (granted) =>
			journal.write(released, { hold: id, granted }),
		);
		this.open.set(id, hold);
		journal.write(hitch, { kind: "held", text: reason, hold: id });
		return hold;
	}

	get(id: string): Hold | undefined {
		return this.open.get(id);
	}

	take(id: string): Hold | undefined {
		const hold = this.open.get(id);
		this.open.delete(id);
		return hold;
	}
}
