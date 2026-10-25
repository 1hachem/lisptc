import { EvalException } from "@repo/interpreter/errors";
import { snapshot } from "@repo/interpreter/image";
import {
	type Interp,
	runSync,
	type State,
	type StateCodec,
} from "@repo/interpreter/lisp";
import {
	arrayToList,
	Cell,
	LispKeyword,
	type List,
	newLispKeyword,
	newSym,
} from "@repo/interpreter/objects";
import { str } from "@repo/interpreter/print";
import { readFailure } from "@repo/interpreter/reader";
import { zList, zString } from "@repo/interpreter/schema";
import type { InterpExtension } from "@repo/interpreter/session";
import type { PromptSource } from "@repo/shared/host";
import { z } from "zod";
import type { BackgroundJobs, Clock, JobSpec, Outcome } from "./ports.ts";
import { registerWatch } from "./watch.ts";

export interface BackgroundHost {
	prompt: PromptSource;
	jobs: BackgroundJobs;
	clock: Clock;
	thread?: string;
}

export function backgroundExtension(host: BackgroundHost): InterpExtension {
	return Object.assign(
		(interp: Interp): void => registerBackground(interp, host),
		{ prompt: host.prompt() },
	);
}

export const jobsCodec: StateCodec<readonly string[]> = {
	toLisp: (jobs) => arrayToList([...jobs]),
	fromLisp: (x) => {
		const jobs: string[] = [];
		for (let at = x; at instanceof Cell; at = at.cdr)
			if (typeof at.car === "string") jobs.push(at.car);
		return jobs;
	},
};

export function permissionsOf(value: unknown): string {
	if (typeof value !== "string")
		throw new EvalException("background: :permissions is a string", value);
	const failure = readFailure(value);
	if (failure !== undefined)
		throw new EvalException(
			`background: :permissions does not read: ${failure.reason}`,
			value,
		);
	return value;
}

function deadlineOf(value: unknown): number {
	const seconds = Number(value);
	if (typeof value !== "string" && Number.isFinite(seconds) && seconds > 0)
		return seconds;
	throw new EvalException("background: :deadline is seconds, above 0", value);
}

function codeOf(expr: unknown): string {
	return typeof expr === "string" ? expr : str(expr);
}

function optionsOf(rest: List): Map<string, unknown> {
	const options = new Map<string, unknown>();
	for (let at: unknown = rest; at instanceof Cell; ) {
		const { car, cdr }: Cell = at;
		if (
			!(car instanceof LispKeyword) ||
			!["fork", "permissions", "deadline"].includes(car.name)
		)
			throw new EvalException(
				"background: options are :fork, :permissions and :deadline",
				car,
			);
		if (!(cdr instanceof Cell))
			throw new EvalException("background: keyword given with no value", car);
		options.set(car.name, cdr.car);
		at = cdr.cdr;
	}
	return options;
}

class Jobs {
	constructor(private readonly held: State<readonly string[]>) {}

	adopt(job: string): void {
		this.held.set([...this.held.get(), job]);
	}

	known(form: string, job: string): string {
		if (this.held.get().includes(job)) return job;
		throw new EvalException(`${form}: no background job by that id`, job);
	}
}

export function registerBackground(interp: Interp, host: BackgroundHost): void {
	const jobs = new Jobs(
		interp.state(
			"background/jobs",
			jobsCodec,
			[],
			"The background jobs this session started, by id.",
		),
	);

	registerWatch(interp, host.jobs, host.clock);

	interp.def(
		"background/start",
		-1,
		'(background/start expr [:fork t] [:permissions "rules"] [:deadline seconds])',
		"Start a background job. background calls it; call background instead.",
		z.tuple([zList]),
		async ([args]) => {
			if (args === null)
				throw new EvalException("background takes an expression", args);
			const { car: expr, cdr: rest } = args;
			const { thread } = host;
			if (thread === undefined)
				throw new EvalException(
					"this session runs no background jobs",
					"background",
					false,
				);
			const options = optionsOf(rest as List);
			const fork = options.get("fork");
			const permissions = options.get("permissions");
			const deadline = options.get("deadline");
			const spec: JobSpec = {
				parent: thread,
				code: codeOf(expr),
				fork: fork === undefined || fork === null ? null : snapshot(interp),
				permissions:
					permissions === undefined || permissions === null
						? null
						: permissionsOf(permissions),
				deadlineSeconds:
					deadline === undefined || deadline === null
						? null
						: deadlineOf(deadline),
			};
			const job = await host.jobs.start(spec);
			jobs.adopt(job);
			return job;
		},
	);

	interp.defineGlobal(
		newSym("background"),
		runSync(
			interp,
			"(macro (expr &rest options) `(background/start ',expr ,@options))",
		),
		{
			signature:
				'(background expr [:fork t] [:permissions "rules"] [:deadline seconds])',
			doc: "Run expr in the background on a REPL of its own and return the job id at once. :fork t runs it on a copy of this image; without it the REPL starts fresh. :permissions holds permission forms as text and can only narrow what this session may call. :deadline stops it after that many seconds. Unless you background-wait on it, its value comes back later as a system event from background:<job>, waking you if your turn ended.",
		},
	);

	interp.def(
		"background-wait",
		1,
		'(background-wait "job")',
		"Wait in this step for a background job and return its printed value. A job you wait on sends no system event later. A failed, cancelled or lost job raises an error.",
		z.tuple([zString]),
		async ([job]) => {
			const id = jobs.known("background-wait", job);
			const waiting = interp.async.start((signal) =>
				host.jobs.wait(id, signal),
			);
			const outcome = (await interp.async.promiseOf(waiting)) as Outcome;
			if ("value" in outcome) return outcome.value;
			throw new EvalException(`job ${id}`, outcome.failure, false);
		},
	);

	interp.def(
		"background-state",
		1,
		'(background-state "job")',
		"Return where a background job stands: :pending, :held, :done, :failed, :cancelled or :lost.",
		z.tuple([zString]),
		async ([job]) =>
			newLispKeyword(
				(await host.jobs.state(jobs.known("background-state", job))).state,
			),
	);

	interp.def(
		"background-cancel",
		1,
		'(background-cancel "job")',
		"Cancel a background job that has not finished. Return t when it was cancelled, nil otherwise.",
		z.tuple([zString]),
		async ([job]) =>
			(await host.jobs.cancel(jobs.known("background-cancel", job)))
				? true
				: null,
	);
}
