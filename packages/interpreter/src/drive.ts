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
