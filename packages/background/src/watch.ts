import type { Eval } from "@repo/interpreter/drive";
import { EvalException } from "@repo/interpreter/errors";
import { type Interp, runSync } from "@repo/interpreter/lisp";
import {
	arrayToList,
	Cell,
	LispKeyword,
	type List,
	listToArray,
	newSym,
	quoteSym,
} from "@repo/interpreter/objects";
import { zAny, zList } from "@repo/interpreter/schema";
import { z } from "zod";
import {
	type Backoff,
	backoffFromLisp,
	backoffOf,
	backoffToLisp,
	delayOf,
} from "./backoff.ts";
import type { BackgroundJobs, Clock } from "./ports.ts";

const DEFAULT_EVERY_MS = 1000;

interface Options {
	readonly values: unknown[];
	readonly options: Map<string, unknown>;
}

function optionsOf(
	form: string,
	rest: List,
	allowed: readonly string[],
): Options {
	const values: unknown[] = [];
	const options = new Map<string, unknown>();
	for (let at: unknown = rest; at instanceof Cell; ) {
		const { car, cdr }: Cell = at;
		if (!(car instanceof LispKeyword) || !allowed.includes(car.name)) {
			values.push(car);
			at = cdr;
			continue;
		}
		if (!(cdr instanceof Cell))
			throw new EvalException(`${form}: keyword given with no value`, car);
		options.set(car.name, cdr.car);
		at = cdr.cdr;
	}
	return { values, options };
}

function millisOf(form: string, what: string, value: unknown): number {
	const ms = Number(value);
	if (typeof value !== "string" && Number.isFinite(ms) && ms >= 0) return ms;
	throw new EvalException(
		`${form}: ${what} is milliseconds, at least 0`,
		value,
	);
}

function countOf(form: string, what: string, value: unknown): number {
	const n = Number(value);
	if (typeof value !== "string" && Number.isInteger(n) && n > 0) return n;
	throw new EvalException(`${form}: ${what} is a positive integer`, value);
}

function optionalMillis(
	form: string,
	options: Map<string, unknown>,
	key: string,
): number | undefined {
	const value = options.get(key);
	return value === undefined || value === null
		? undefined
		: millisOf(form, `:${key}`, value);
}

class TimedOut extends EvalException {}

const MACROS: readonly {
	name: string;
	source: string;
	signature: string;
	doc: string;
}[] = [
	{
		name: "poll-until",
		source:
			"(macro (test &rest options) `(background/poll-until (lambda () ,test) ,@options))",
		signature: "(poll-until test [:every ms] [:timeout ms])",
		doc: "Evaluate test every :every ms (default 1000) until it is non-nil and return that value. Past :timeout ms, raise an error.",
	},
	{
		name: "watch-until",
		source:
			"(macro (expr pred &rest options) `(background/watch-until (lambda () ,expr) ,pred ,@options))",
		signature: "(watch-until expr pred [:every ms] [:timeout ms])",
		doc: "Evaluate expr every :every ms (default 1000) and call pred on its value; return the first value pred accepts. Past :timeout ms, raise an error.",
	},
	{
		name: "retry",
		source:
			"(macro (n &rest body) (cond ((eq (car body) :backoff) `(background/retry ,n ,(car (cdr body)) (lambda () ,@(cdr (cdr body))))) (t `(background/retry ,n nil (lambda () ,@body)))))",
		signature: "(retry n [:backoff spec] body...)",
		doc: "Run body up to n times until it does not raise, and return its value. Between attempts wait as the backoff spec says, none without one. The last error is raised again.",
	},
	{
		name: "with-timeout",
		source:
			"(macro (ms &rest body) `(background/with-timeout ,ms (lambda () ,@body)))",
		signature: "(with-timeout ms body...)",
		doc: "Run body and return its value, or raise an error once ms pass while it waits.",
	},
	{
		name: "every",
		source:
			"(macro (ms &rest body) (cond ((eq (car body) :times) `(background/every ,ms ,(car (cdr body)) (lambda () ,@(cdr (cdr body))))) (t `(background/every ,ms nil (lambda () ,@body)))))",
		signature: "(every ms [:times n] body...)",
		doc: "Run body, then wait ms, again and again: n times with :times, else until cancelled or past the deadline. Return the list of values.",
	},
];

export function registerWatch(
	interp: Interp,
	jobs: BackgroundJobs,
	clock: Clock,
): void {
	function* call(fn: unknown, ...args: unknown[]): Eval {
		return yield* interp.evalGen(
			arrayToList([fn, ...args.map((arg) => arrayToList([quoteSym, arg]))]),
			null,
		);
	}

	function* pause(ms: number): Eval<void> {
		if (ms <= 0) return;
		const sleeping = interp.async.start((signal) => jobs.sleep(ms, signal));
		yield interp.async.promiseOf(sleeping);
	}

	function* until(
		form: string,
		options: Map<string, unknown>,
		probe: () => Eval<{ done: boolean; value: unknown }>,
	): Eval {
		const every = optionalMillis(form, options, "every") ?? DEFAULT_EVERY_MS;
		const timeout = optionalMillis(form, options, "timeout");
		const started = clock.now();
		for (;;) {
			const { done, value } = yield* probe();
			if (done) return value;
			const spent = clock.now() - started;
			if (timeout !== undefined && spent >= timeout)
				throw new TimedOut(`${form}: timed out after ms`, timeout);
			yield* pause(
				timeout === undefined ? every : Math.min(every, timeout - spent),
			);
		}
	}

	interp.def(
		"sleep",
		1,
		"(sleep ms)",
		"Wait ms milliseconds, then return nil. The wait is the host's timer, so a durable host keeps it across restarts.",
		z.tuple([zAny]),
		async ([ms]) => {
			const sleeping = interp.async.start((signal) =>
				jobs.sleep(millisOf("sleep", "the wait", ms), signal),
			);
			await interp.async.promiseOf(sleeping);
			return null;
		},
	);

	interp.def(
		"backoff",
		-1,
		"(backoff :constant|:linear|:exponential [:base ms] [:factor n] [:max ms] [:jitter 0..1])",
		"Return a backoff spec for retry. :constant waits :base ms every time. :linear waits :base, then :factor ms more each attempt (default :base). :exponential waits :base times :factor (default 2) to the attempt. :max caps the wait. :jitter spreads each wait by up to that fraction either way. :base defaults to 1000.",
		z.tuple([zList]),
		([rest]) => {
			const { values, options } = optionsOf("backoff", rest, [
				"base",
				"factor",
				"max",
				"jitter",
			]);
			const [kind] = values;
			if (values.length !== 1 || !(kind instanceof LispKeyword))
				throw new EvalException("backoff takes one kind, then options", rest);
			return backoffToLisp(backoffOf(kind.name, options));
		},
	);

	interp.def(
		"backoff-delay",
		2,
		"(backoff-delay spec attempt)",
		"Return the ms a backoff spec waits after attempt (0 for the first retry).",
		z.tuple([zAny, zAny]),
		([spec, attempt]) =>
			BigInt(
				delayOf(
					backoffFromLisp(spec),
					Number(attempt) >= 0 ? Number(attempt) : 0,
					clock.random(),
				),
			),
	);

	interp.defGen(
		"background/poll-until",
		-1,
		"(background/poll-until thunk [:every ms] [:timeout ms])",
		"Call thunk until it returns non-nil. poll-until calls it; call poll-until instead.",
		z.tuple([zList]),
		function* ([args]) {
			if (args === null)
				throw new EvalException("poll-until takes a test", args);
			const { car: thunk, cdr: rest } = args;
			const { options } = optionsOf("poll-until", rest as List, [
				"every",
				"timeout",
			]);
			return yield* until("poll-until", options, function* () {
				const value = yield* call(thunk);
				return { done: value !== null, value };
			});
		},
	);

	interp.defGen(
		"background/watch-until",
		-1,
		"(background/watch-until thunk pred [:every ms] [:timeout ms])",
		"Call thunk until pred accepts its value. watch-until calls it; call watch-until instead.",
		z.tuple([zList]),
		function* ([args]) {
			const [thunk, pred] = listToArray(args);
			const rest = args?.cdr instanceof Cell ? args.cdr.cdr : null;
			const { options } = optionsOf("watch-until", rest as List, [
				"every",
				"timeout",
			]);
			return yield* until("watch-until", options, function* () {
				const value = yield* call(thunk);
				return { done: (yield* call(pred, value)) !== null, value };
			});
		},
	);

	interp.defGen(
		"background/retry",
		3,
		"(background/retry n spec thunk)",
		"Call thunk up to n times until it does not raise. retry calls it; call retry instead.",
		z.tuple([zAny, zAny, zAny]),
		function* ([n, spec, thunk]) {
			const attempts = countOf("retry", "the attempt count", n);
			const backoff: Backoff | undefined =
				spec === null ? undefined : backoffFromLisp(spec);
			for (let attempt = 0; ; attempt += 1) {
				try {
					return yield* call(thunk);
				} catch (error) {
					if (!(error instanceof EvalException) || attempt + 1 >= attempts)
						throw error;
				}
				if (backoff !== undefined)
					yield* pause(delayOf(backoff, attempt, clock.random()));
			}
		},
	);

	interp.defGen(
		"background/every",
		3,
		"(background/every ms times thunk)",
		"Call thunk every ms. every calls it; call every instead.",
		z.tuple([zAny, zAny, zAny]),
		function* ([ms, times, thunk]) {
			const wait = millisOf("every", "the interval", ms);
			const count =
				times === null ? undefined : countOf("every", ":times", times);
			const values: unknown[] = [];
			for (let run = 0; count === undefined || run < count; run += 1) {
				if (run > 0) yield* pause(wait);
				values.push(yield* call(thunk));
			}
			return arrayToList(values);
		},
	);

	interp.defGen(
		"background/with-timeout",
		2,
		"(background/with-timeout ms thunk)",
		"Call thunk, raising once ms pass. with-timeout calls it; call with-timeout instead.",
		z.tuple([zAny, zAny]),
		function* ([ms, thunk]) {
			const limit = millisOf("with-timeout", "the limit", ms);
			const stop = new AbortController();
			const expired = jobs.sleep(limit, stop.signal).then(() => {
				throw new TimedOut("with-timeout: timed out after ms", limit);
			});
			expired.catch(() => {});
			const running = call(thunk);
			try {
				let step = running.next();
				while (!step.done) {
					let resumed: unknown;
					try {
						resumed = yield Promise.race([step.value, expired]);
					} catch (error) {
						if (error instanceof TimedOut) {
							running.return(undefined);
							throw error;
						}
						step = running.throw(error);
						continue;
					}
					step = running.next(resumed);
				}
				return step.value;
			} finally {
				stop.abort();
			}
		},
	);

	for (const { name, source, signature, doc } of MACROS)
		interp.defineGlobal(newSym(name), runSync(interp, source), {
			signature,
			doc,
		});
}
