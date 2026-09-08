import { z } from "zod";
import {
	Cell,
	EvalException,
	type Interp,
	type List,
	newLispKeyword,
	zList,
} from "./lisp.ts";

export const DEFAULT_TIMEOUT_MS = 30_000;
export const AWAIT_TIMEOUT_MS = 50_000;

export type Dispatch = (
	op: string,
	payload: unknown,
	signal?: AbortSignal,
) => Promise<unknown>;

export type PromiseState = "pending" | "fulfilled" | "rejected";

interface Tracked {
	state: PromiseState;
	controller?: AbortController;
}

const tracked = new WeakMap<Promise<unknown>, Tracked>();

const zPromise = z.custom<Promise<unknown>>(
	(x) => x instanceof Promise,
	"promise expected",
);

const message = (e: unknown): string =>
	e instanceof Error ? e.message : String(e);

function listToArray(list: List): unknown[] {
	const out: unknown[] = [];
	for (let j = list; j !== null; j = j.cdr as List) out.push(j.car);
	return out;
}

function arrayToList(arr: unknown[]): List {
	let out: List = null;
	for (let i = arr.length - 1; i >= 0; i--) out = new Cell(arr[i], out);
	return out;
}

function toPromises(x: unknown): Promise<unknown>[] {
	const arr = x === null || x instanceof Cell ? listToArray(x as List) : [x];
	return arr.map((p) => {
		if (!(p instanceof Promise)) throw new EvalException("not a promise", p);
		return p;
	});
}

function parseTimeout(x: unknown): number {
	if (x === undefined) return AWAIT_TIMEOUT_MS;
	const ms = Number(x);
	if (!Number.isFinite(ms) || ms < 0)
		throw new EvalException("invalid await timeout", x);
	return ms;
}

export function withTimeout<T>(
	promise: Promise<T>,
	timeoutMs: number,
	what: string,
): Promise<T> {
	if (!Number.isFinite(timeoutMs)) return promise;
	let timer: ReturnType<typeof setTimeout>;
	return Promise.race([
		promise.finally(() => clearTimeout(timer)),
		new Promise<never>((_, reject) => {
			timer = setTimeout(
				() => reject(new EvalException(`${what} timed out`, timeoutMs, false)),
				timeoutMs,
			);
			timer.unref?.();
		}),
	]);
}

export class Promises {
	private readonly live = new Set<Promise<unknown>>();

	constructor(
		private readonly dispatch: Dispatch,
		private readonly toLisp: (raw: unknown) => unknown,
	) {}

	call(
		op: string,
		payload: unknown,
		timeoutMs = DEFAULT_TIMEOUT_MS,
	): Promise<unknown> {
		return withTimeout(this.dispatch(op, payload), timeoutMs, op);
	}

	start(
		op: string,
		payload: unknown,
		finalize?: (raw: unknown) => unknown,
	): Promise<unknown> {
		const controller = new AbortController();
		return this.track(
			this.dispatch(op, payload, controller.signal).then(
				finalize ?? ((raw) => this.toLisp(raw)),
			),
			controller,
		);
	}

	track(
		promise: Promise<unknown>,
		controller?: AbortController,
	): Promise<unknown> {
		const record: Tracked = { state: "pending", controller };
		tracked.set(promise, record);
		this.live.add(promise);
		promise.then(
			() => {
				record.state = "fulfilled";
				this.live.delete(promise);
			},
			() => {
				record.state = "rejected";
				this.live.delete(promise);
			},
		);
		return promise;
	}

	shutdown(): void {
		for (const promise of this.live) tracked.get(promise)?.controller?.abort();
		this.live.clear();
	}

	installBuiltins(interp: Interp): void {
		interp.def(
			"await",
			-1,
			"(await promise [timeout-ms])",
			"Wait for a promise to settle and return its value; re-raises its error. Optional timeout in milliseconds.",
			z.tuple([zList]),
			([rest]) => {
				const args = listToArray(rest);
				const [promise] = toPromises(args[0]);
				return withTimeout(promise, parseTimeout(args[1]), "await");
			},
		);

		interp.defPromise(
			"promise-all",
			1,
			"(promise-all promises)",
			"Return one promise for the values of every promise in the list, in order. It rejects as soon as any of them does, like JavaScript's Promise.all — use promise-all-settled to keep the ones that succeeded.",
			z.tuple([zList]),
			([list]) => this.track(Promise.all(toPromises(list)).then(arrayToList)),
		);

		interp.defPromise(
			"promise-all-settled",
			1,
			"(promise-all-settled promises)",
			'Return one promise for how every promise in the list turned out, in order, as (:fulfilled value) or (:rejected "message"). It never rejects, so one failure does not discard its siblings. Like JavaScript\'s Promise.allSettled.',
			z.tuple([zList]),
			([list]) =>
				this.track(
					Promise.allSettled(toPromises(list)).then((results) =>
						arrayToList(
							results.map((r) =>
								r.status === "fulfilled"
									? arrayToList([newLispKeyword("fulfilled"), r.value])
									: arrayToList([
											newLispKeyword("rejected"),
											message(r.reason),
										]),
							),
						),
					),
				),
		);

		interp.defPromise(
			"promise-any",
			1,
			"(promise-any promises)",
			"Return one promise for the value of the first promise in the list to succeed. It rejects only if they all do, like JavaScript's Promise.any.",
			z.tuple([zList]),
			([list]) =>
				this.track(
					Promise.any(toPromises(list)).catch((ex) => {
						const errors = (ex as { errors?: unknown[] }).errors;
						throw new EvalException(
							"every promise rejected",
							Array.isArray(errors)
								? errors.map(message).join("; ")
								: message(ex),
							false,
						);
					}),
				),
		);

		interp.defPromise(
			"promise-race",
			1,
			"(promise-race promises)",
			"Return one promise that settles the way the first promise in the list to settle did, whether it succeeded or failed. Like JavaScript's Promise.race.",
			z.tuple([zList]),
			([list]) => this.track(Promise.race(toPromises(list))),
		);

		interp.def(
			"promise-state",
			1,
			"(promise-state promise)",
			"Return how a promise stands, without waiting: :pending, :fulfilled or :rejected.",
			z.tuple([zPromise]),
			([promise]) => newLispKeyword(tracked.get(promise)?.state ?? "unknown"),
		);

		interp.def(
			"promises",
			0,
			"(promises)",
			"Return the promises still pending, each as (promise :pending). A settled one is dropped.",
			z.tuple([]),
			() =>
				arrayToList(
					[...this.live].map((promise) =>
						arrayToList([
							promise,
							newLispKeyword(tracked.get(promise)?.state ?? "unknown"),
						]),
					),
				),
		);

		interp.def(
			"cancel",
			1,
			"(cancel promise)",
			"Abort the work a promise came from and stop tracking it; returns t if there was something to abort. A promise is not cancellable in itself, so this aborts the request behind it — one built by promise-all and friends has nothing of its own to abort and returns nil.",
			z.tuple([zPromise]),
			([promise]) => {
				const record = tracked.get(promise);
				this.live.delete(promise);
				if (!record?.controller) return null;
				record.controller.abort();
				return true;
			},
		);
	}
}
