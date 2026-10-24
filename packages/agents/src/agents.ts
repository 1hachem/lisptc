import { effect } from "@repo/interpreter/effects";
import { EvalException } from "@repo/interpreter/errors";
import { snapshot } from "@repo/interpreter/image";
import { type Interp, runSync, type State } from "@repo/interpreter/lisp";
import {
	arrayToList,
	Cell,
	LispKeyword,
	type List,
	newLispKeyword,
	newSym,
} from "@repo/interpreter/objects";
import { keyName } from "@repo/interpreter/plist";
import { str } from "@repo/interpreter/print";
import { zList, zString } from "@repo/interpreter/schema";
import type { InterpExtension } from "@repo/interpreter/session";
import type { PromptSource } from "@repo/shared/host";
import { z } from "zod";
import {
	FINISHED,
	type JobKind,
	type JobRecord,
	jobPlist,
	jobsCodec,
	type SpawnedAgent,
	spawnedCodec,
} from "./job-table.ts";
import type {
	AgentDefinition,
	AgentDefinitions,
	ChatSeed,
	Jobs,
	Outcome,
	ReplSeed,
	Work,
} from "./ports.ts";

export interface AgentsHost {
	prompt: PromptSource;
	definitions: AgentDefinitions;
	jobs?: Jobs;
}

export const DEFAULT_MAX_STEPS = 20;

export const BOUNDED_DEFINE = "agents/define-bounded";

export interface AgentsExtension extends InterpExtension {
	readonly asks: readonly string[];
}

export function agentsExtension(host: AgentsHost): AgentsExtension {
	return Object.assign((interp: Interp): void => registerAgents(interp, host), {
		prompt: host.prompt(),
		asks: [BOUNDED_DEFINE],
	});
}

interface Parsed {
	readonly values: unknown[];
	readonly options: Map<string, unknown>;
}

function parse(form: string, rest: List, allowed: readonly string[]): Parsed {
	const values: unknown[] = [];
	const options = new Map<string, unknown>();
	let at: unknown = rest;
	while (at instanceof Cell) {
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

function nameOf(form: string, value: unknown): string {
	try {
		return keyName(value);
	} catch {
		throw new EvalException(`${form}: an agent name is a string`, value);
	}
}

function textOf(form: string, what: string, value: unknown): string {
	if (typeof value === "string") return value;
	throw new EvalException(`${form}: ${what} is a string`, value);
}

function stepsOf(value: unknown): number {
	if (value === undefined) return DEFAULT_MAX_STEPS;
	const steps = Number(value);
	if (Number.isInteger(steps) && steps > 0) return steps;
	throw new EvalException("send: :max-steps is a positive integer", value);
}

function seedOf(interp: Interp, value: unknown): ReplSeed {
	const from = value === undefined ? "fresh" : nameOf("spawn", value);
	if (from === "fresh") return { from };
	if (from === "fork") return { from, image: snapshot(interp) };
	throw new EvalException("spawn: :repl is :fresh or :fork", value);
}

function chatOf(value: unknown): ChatSeed {
	const from = value === undefined ? "fresh" : nameOf("spawn", value);
	if (from === "fresh" || from === "fork") return { from };
	throw new EvalException("spawn: :chat is :fresh or :fork", value);
}

const INTERRUPTED: Outcome = {
	failure: "interrupted: the host no longer runs this job",
};

class JobTable {
	constructor(
		private readonly records: State<readonly JobRecord[]>,
		private readonly spawned: State<readonly SpawnedAgent[]>,
	) {}

	agent(name: string): string | undefined {
		return this.spawned.get().find((entry) => entry.name === name)?.agent;
	}

	adopt(name: string, agent: string): void {
		this.spawned.set([
			...this.spawned.get().filter((entry) => entry.name !== name),
			{ name, agent },
		]);
	}

	record(id: string): JobRecord | undefined {
		return this.records.get().find((record) => record.id === id);
	}

	all(): readonly JobRecord[] {
		return this.records.get();
	}

	put(record: JobRecord): JobRecord {
		this.records.set([
			...this.records.get().filter((held) => held.id !== record.id),
			record,
		]);
		return record;
	}
}

export function registerAgents(interp: Interp, host: AgentsHost): void {
	const table = new JobTable(
		interp.state(
			"agents/jobs",
			jobsCodec,
			[],
			"The background jobs this session started, with where each stands. Read it through job-state and jobs.",
		),
		interp.state(
			"agents/spawned",
			spawnedCodec,
			[],
			"The sub-agents this session spawned, by name.",
		),
	);

	function jobs(form: string): Jobs {
		if (host.jobs === undefined)
			throw new EvalException(
				"this session runs no background jobs",
				form,
				false,
			);
		return host.jobs;
	}

	function known(form: string, job: string): JobRecord {
		const record = table.record(job);
		if (record === undefined)
			throw new EvalException(`${form}: no job by that id`, job);
		return record;
	}

	async function refreshed(record: JobRecord): Promise<JobRecord> {
		if (FINISHED.has(record.state)) return record;
		const seen = await jobs("job-state").peek(record.id);
		if (seen === undefined)
			return table.put({ ...record, state: "failed", outcome: INTERRUPTED });
		return table.put(
			seen.outcome === undefined
				? { ...record, state: seen.state }
				: { ...record, state: seen.state, outcome: seen.outcome },
		);
	}

	async function started(kind: JobKind, label: string, work: Work) {
		const id = await jobs("spawn").submit(work);
		table.put({ id, kind, label, state: "queued" });
		return id;
	}

	async function definitionOf(
		name: string,
		prompt: unknown,
	): Promise<AgentDefinition> {
		if (prompt !== undefined)
			return { name, prompt: textOf("spawn", ":prompt", prompt) };
		const saved = await host.definitions.get(name);
		if (saved === undefined)
			throw new EvalException(
				"spawn: no saved agent by that name; define it with defagent or pass :prompt",
				name,
			);
		return saved;
	}

	interp.def(
		"agents/quiet",
		0,
		"(agents/quiet)",
		"Ask the harness not to hand this message to the agent. quietly calls it before its forms run; call quietly instead.",
		z.tuple([]),
		() => {
			effect.emit(interp.channels, { harness: { type: "quiet" } });
			return null;
		},
	);
	interp.defineGlobal(
		newSym("quietly"),
		runSync(
			interp,
			"(macro (&rest forms) (cons 'progn (cons '(agents/quiet) forms)))",
		),
		{
			signature: "(quietly form...)",
			doc: "Run the forms of a message without handing the message to the agent, even when a form inside fails or waits. The message and what the forms printed stay in the chat, so the agent reads them on its next turn. Return the value of the last form.",
		},
	);

	function define(form: string, allowed: readonly string[]) {
		return async ([rest]: [List]) => {
			const { values, options } = parse(form, rest, allowed);
			if (values.length !== 1)
				throw new EvalException("defagent takes one name, then :prompt", rest);
			const name = nameOf("defagent", values[0]);
			const prompt = textOf("defagent", ":prompt", options.get("prompt"));
			const permissions = options.get("permissions");
			await host.definitions.put(
				permissions === undefined
					? { name, prompt }
					: {
							name,
							prompt,
							permissions: textOf("defagent", ":permissions", permissions),
						},
			);
			return name;
		};
	}

	interp.def(
		"agents/define",
		-1,
		'(agents/define "name" :prompt "...")',
		"Save an agent definition without permissions. defagent calls it; call defagent instead.",
		z.tuple([zList]),
		define("defagent", ["prompt"]),
	);

	interp.def(
		BOUNDED_DEFINE,
		-1,
		`(${BOUNDED_DEFINE} "name" :prompt "..." :permissions "...")`,
		"Save an agent definition with the permission rules that bound it. It waits on the user's approval. defagent calls it; call defagent instead.",
		z.tuple([zList]),
		define("defagent", ["prompt", "permissions"]),
	);

	interp.defineGlobal(
		newSym("defagent"),
		runSync(
			interp,
			`(macro (&rest args) (cons (if (member :permissions args) '${BOUNDED_DEFINE} 'agents/define) args))`,
		),
		{
			signature: '(defagent "name" :prompt "..." [:permissions "rules"])',
			doc: "Save an agent definition under a name, replacing one of the same name. Spawn it later by that name. :permissions holds permission forms as text; they bound the agent on top of the workspace's rules and can only tighten them. Saving permissions waits on the user's approval. Return the name.",
		},
	);

	interp.def(
		"agents",
		0,
		"(agents)",
		"Return the names of the saved agent definitions.",
		z.tuple([]),
		async () => {
			let names: List = null;
			const saved = await host.definitions.all();
			for (const { name } of [...saved].reverse())
				names = new Cell(name, names);
			return names;
		},
	);

	interp.def(
		"spawn",
		-1,
		'(spawn "name" [:prompt "..."] [:repl :fresh|:fork] [:chat :fresh|:fork]) or (spawn :code form)',
		"Start a sub-agent under a name and return the name. Without :prompt it runs the saved definition of that name. :repl :fresh gives it a new image; :repl :fork gives it a copy of this one as it stands. :chat :fresh starts it with no conversation; :chat :fork starts it with a copy of this chat so far. Spawning a name again starts it over. With :code, run the form in the background on a copy of this image and return its job id at once; what it prints comes back as a system event from job:id unless you job-wait on it.",
		z.tuple([zList]),
		async ([rest]) => {
			const { values, options } = parse("spawn", rest, [
				"prompt",
				"repl",
				"chat",
				"code",
			]);
			if (options.has("code")) {
				if (values.length > 0)
					throw new EvalException("spawn :code takes no name", rest);
				const code = options.get("code");
				const source = typeof code === "string" ? code : str(code);
				return await started("code", source, {
					kind: "code",
					source,
					image: snapshot(interp),
				});
			}
			if (values.length !== 1)
				throw new EvalException("spawn takes one name, then options", rest);
			const name = nameOf("spawn", values[0]);
			const seed = seedOf(interp, options.get("repl"));
			const chat = chatOf(options.get("chat"));
			const definition = await definitionOf(name, options.get("prompt"));
			table.adopt(name, await jobs("spawn").spawn({ definition, seed, chat }));
			return name;
		},
	);

	interp.def(
		"send",
		-1,
		'(send :to "name" "message" [:max-steps n])',
		"Hand a message to a spawned sub-agent as a job and return the job id at once; keep working. Unless you job-wait on it, its reply comes back later as a system event from agent:name, waking you if your turn ended. Messages to one agent run in turn.",
		z.tuple([zList]),
		async ([rest]) => {
			const { values, options } = parse("send", rest, ["to", "max-steps"]);
			if (values.length !== 1)
				throw new EvalException("send takes one message string", rest);
			const message = textOf("send", "the message", values[0]);
			const to = options.get("to");
			if (to === undefined)
				throw new EvalException("send: say who with :to", rest);
			const name = nameOf("send", to);
			const maxSteps = stepsOf(options.get("max-steps"));
			const agent = table.agent(name);
			if (agent === undefined)
				throw new EvalException(
					"send: no running agent by that name; spawn it first",
					name,
				);
			return await started("agent", name, {
				kind: "agent",
				agent,
				name,
				message,
				maxSteps,
			});
		},
	);

	interp.def(
		"job-wait",
		1,
		'(job-wait "job")',
		"Wait in this step for a job to finish and return what it replied or printed. A job you wait on sends no system event later. A failed, cancelled or interrupted job raises an error.",
		z.tuple([zString]),
		async ([job]) => {
			let record = await refreshed(known("job-wait", job));
			if (!FINISHED.has(record.state)) {
				const waiting = interp.async.start((signal) =>
					jobs("job-wait").wait(job, signal),
				);
				const outcome = (await interp.async.promiseOf(waiting)) as Outcome;
				record = table.put({
					...record,
					state: "reply" in outcome ? "done" : "failed",
					outcome,
				});
			}
			const { outcome } = record;
			if (outcome !== undefined && "reply" in outcome) return outcome.reply;
			throw new EvalException(
				`job ${job}`,
				outcome?.failure ?? record.state,
				false,
			);
		},
	);

	interp.def(
		"job-state",
		1,
		'(job-state "job")',
		"Return where a job stands: :queued, :running, :done, :failed or :cancelled. A job the host lost to a restart reads :failed.",
		z.tuple([zString]),
		async ([job]) =>
			newLispKeyword((await refreshed(known("job-state", job))).state),
	);

	interp.def(
		"job-cancel",
		1,
		'(job-cancel "job")',
		"Cancel a job that has not finished. Return t when it was cancelled, nil when it had already finished.",
		z.tuple([zString]),
		async ([job]) => {
			const record = await refreshed(known("job-cancel", job));
			if (FINISHED.has(record.state)) return null;
			if (!(await jobs("job-cancel").cancel(job))) return null;
			table.put({ ...record, state: "cancelled" });
			return true;
		},
	);

	interp.def(
		"jobs",
		0,
		"(jobs)",
		"Return every job this session started, oldest first, each as (:id :kind :label :state) with :reply or :failure once it ended.",
		z.tuple([]),
		async () => {
			const records: JobRecord[] = [];
			for (const record of table.all()) records.push(await refreshed(record));
			return arrayToList(records.map(jobPlist));
		},
	);
}
