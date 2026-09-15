import { readFileSync } from "node:fs";
import { z } from "zod";
import { withTimeout } from "../../async.ts";
import {
	arrayToList,
	Cell,
	EvalException,
	type Interp,
	type InterpExtension,
	type List,
	listToArray,
	newLispKeyword,
	zList,
} from "../../lisp.ts";

export const AWAIT_TIMEOUT_MS = 50_000;

const zPromise = z.custom<Promise<unknown>>(
	(x) => x instanceof Promise,
	"promise expected",
);

const message = (e: unknown): string =>
	e instanceof Error ? e.message : String(e);

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

const PROMPT: string = readFileSync(
	new URL("./promises.ptc", import.meta.url),
	"utf8",
);

export function promisesExtension(): InterpExtension {
	return Object.assign((interp: Interp): void => registerPromises(interp), {
		prompt: PROMPT,
	});
}

export function registerPromises(interp: Interp): void {
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
		([list]) => Promise.all(toPromises(list)).then(arrayToList),
	);

	interp.defPromise(
		"promise-all-settled",
		1,
		"(promise-all-settled promises)",
		'Return one promise for how every promise in the list turned out, in order, as (:fulfilled value) or (:rejected "message"). It never rejects, so one failure does not discard its siblings. Like JavaScript\'s Promise.allSettled.',
		z.tuple([zList]),
		([list]) =>
			Promise.allSettled(toPromises(list)).then((results) =>
				arrayToList(
					results.map((r) =>
						r.status === "fulfilled"
							? arrayToList([newLispKeyword("fulfilled"), r.value])
							: arrayToList([newLispKeyword("rejected"), message(r.reason)]),
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
			Promise.any(toPromises(list)).catch((ex) => {
				const errors = (ex as { errors?: unknown[] }).errors;
				throw new EvalException(
					"every promise rejected",
					Array.isArray(errors) ? errors.map(message).join("; ") : message(ex),
					false,
				);
			}),
	);

	interp.defPromise(
		"promise-race",
		1,
		"(promise-race promises)",
		"Return one promise that settles the way the first promise in the list to settle did, whether it succeeded or failed. Like JavaScript's Promise.race.",
		z.tuple([zList]),
		([list]) => Promise.race(toPromises(list)),
	);

	interp.def(
		"promise-state",
		1,
		"(promise-state promise)",
		"Return how a promise stands, without waiting: :pending, :fulfilled or :rejected.",
		z.tuple([zPromise]),
		([promise]) => newLispKeyword(interp.async.stateOf(promise)),
	);

	interp.def(
		"promises",
		0,
		"(promises)",
		"Return the promises still pending, each as (promise :pending). A settled one is dropped.",
		z.tuple([]),
		() =>
			arrayToList(
				interp.async
					.pending()
					.map((promise) =>
						arrayToList([
							promise,
							newLispKeyword(interp.async.stateOf(promise)),
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
		([promise]) => interp.async.cancel(promise) || null,
	);
}
