import { effect } from "@repo/interpreter/effects";
import { EvalException } from "@repo/interpreter/errors";
import { snapshot } from "@repo/interpreter/image";
import { type Interp, runSync } from "@repo/interpreter/lisp";
import {
	arrayToList,
	Cell,
	LispKeyword,
	type List,
	listToArray,
	newLispKeyword,
	newSym,
} from "@repo/interpreter/objects";
import { keyName } from "@repo/interpreter/plist";
import { readFailure } from "@repo/interpreter/reader";
import { zList, zString } from "@repo/interpreter/schema";
import type { InterpExtension } from "@repo/interpreter/session";
import type { PromptSource, SourceFolder } from "@repo/shared/host";
import { z } from "zod";
import { AGENT_FOLDER, writeDefinition } from "./definition.ts";
import { Handles, handlesCodec } from "./handles.ts";
import { AgentLibrary } from "./library.ts";
import { DELEGATE_PREFIX, delegateName, isDelegateName } from "./names.ts";
import type {
	AgentDefinition,
	AgentThreads,
	ChatSeed,
	Outcome,
	ReplSeed,
} from "./ports.ts";

export interface AgentsHost {
	prompt: PromptSource;
	folder: SourceFolder;
	workspace: string;
	roster?: readonly string[];
	threads?: AgentThreads;
}

export const DEFAULT_MAX_STEPS = 20;

export const DEFINE = "agents/define";

export const BOUNDED_DEFINE = "agents/define-bounded";

export const KEEP = "agent-keep";

export const FORGET = "agent-forget";

export const DELEGATE_PROMPT =
	"Do the brief, nothing else. Final answer: result first, then evidence (forms run, values seen, paths), then what not checked.";

export interface AgentsExtension extends InterpExtension {
	readonly asks: readonly string[];
}

export function agentsExtension(host: AgentsHost): AgentsExtension {
	return Object.assign((interp: Interp): void => registerAgents(interp, host), {
		prompt: host.prompt(),
		asks: [DEFINE, BOUNDED_DEFINE, KEEP, FORGET],
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

function countOf(form: string, what: string, value: unknown): number {
	const count = Number(value);
	if (Number.isInteger(count) && count > 0) return count;
	throw new EvalException(`${form}: ${what} is a positive integer`, value);
}

function rosterOf(value: unknown): readonly string[] {
	if (value !== null && !(value instanceof Cell))
		throw new EvalException("defagent: :roster is a list of names", value);
	return listToArray(value).map((member) => nameOf("defagent", member));
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

function definitionFrom(
	form: string,
	name: string,
	options: Map<string, unknown>,
): AgentDefinition {
	const prompt = textOf(form, ":prompt", options.get("prompt"));
	const permissions = options.get("permissions");
	const roster = options.get("roster");
	const budget = options.get("budget");
	if (permissions !== undefined) {
		const rules = textOf(form, ":permissions", permissions);
		const failure = readFailure(rules);
		if (failure !== undefined)
			throw new EvalException(
				`${form}: :permissions does not read: ${failure.reason}`,
				rules,
			);
	}
	return {
		name,
		prompt,
		...(permissions === undefined
			? {}
			: { permissions: permissions as string }),
		...(options.has("roster") ? { roster: rosterOf(roster) } : {}),
		...(budget === undefined
			? {}
			: { budget: countOf(form, ":budget", budget) }),
	};
}

const DEFINE_KEYS = ["prompt", "roster", "budget"];

export function registerAgents(interp: Interp, host: AgentsHost): void {
	const handles = new Handles(
		interp.state(
			"agents/spawned",
			handlesCodec,
			[],
			"The sub-agents this session spawned, by name, with the thread each runs on.",
		),
	);

	const library = new AgentLibrary(host.folder, host.workspace, host.roster);

	function threads(form: string): AgentThreads {
		if (host.threads === undefined)
			throw new EvalException("this session runs no sub-agents", form, false);
		return host.threads;
	}

	async function definitionOf(
		name: string,
		options: Map<string, unknown>,
	): Promise<AgentDefinition> {
		if (options.has("prompt")) {
			if ((await library.saved(name)) !== undefined)
				throw new EvalException(
					"spawn: a saved agent has that name; spawn it without :prompt, or give this one another name",
					name,
				);
			return definitionFrom("spawn", name, options);
		}
		const definition = await library.saved(name);
		if (definition === undefined)
			throw new EvalException(
				"spawn: no saved agent by that name; define it with defagent or pass :prompt",
				name,
			);
		return definition;
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

	function define(allowed: readonly string[]) {
		return async ([rest]: [List]) => {
			const { values, options } = parse("defagent", rest, allowed);
			if (values.length !== 1)
				throw new EvalException("defagent takes one name, then :prompt", rest);
			const name = nameOf("defagent", values[0]);
			const definition = definitionFrom("defagent", name, options);
			await library.save(name, writeDefinition(definition));
			const spawned = handles.of(name);
			if (spawned?.unsaved !== undefined)
				handles.adopt({ name, child: spawned.child });
			return name;
		};
	}

	interp.def(
		DEFINE,
		-1,
		`(${DEFINE} "name" :prompt "...")`,
		"Save an agent definition without permissions. It waits on the user's approval. defagent calls it; call defagent instead.",
		z.tuple([zList]),
		define(DEFINE_KEYS),
	);

	interp.def(
		BOUNDED_DEFINE,
		-1,
		`(${BOUNDED_DEFINE} "name" :prompt "..." :permissions "...")`,
		"Save an agent definition with the permission rules that bound it. It waits on the user's approval. defagent calls it; call defagent instead.",
		z.tuple([zList]),
		define([...DEFINE_KEYS, "permissions"]),
	);

	interp.defineGlobal(
		newSym("defagent"),
		runSync(
			interp,
			`(macro (&rest args) (cons (if (member :permissions args) '${BOUNDED_DEFINE} '${DEFINE}) args))`,
		),
		{
			signature:
				'(defagent "name" :prompt "..." [:permissions "rules"] [:roster \'("name"...)] [:budget n])',
			doc: `Save an agent definition as ${AGENT_FOLDER}/<name>.ptc, replacing one of the same name, once the user approves. Spawn it later by that name. Check (agents) first and reuse a saved agent that fits; for one-off work spawn with :prompt instead, and agent-keep it once it proved worth reusing. :permissions holds permission forms as text; they bound the agent on top of the workspace's rules and can only tighten them. :roster names the agents it may spawn in turn. :budget caps the steps it may spend. Return the name.`,
		},
	);

	interp.def(
		"agents",
		0,
		"(agents)",
		`Return the names of the agent definitions saved in ${AGENT_FOLDER}/.`,
		z.tuple([]),
		async () => arrayToList(await library.names()),
	);

	interp.def(
		"agent-definition",
		1,
		'(agent-definition "name")',
		`Return the saved definition of that name as the text of its ${AGENT_FOLDER}/<name>.ptc, or nil when none is saved. Read it to tell whether a saved agent fits the work before spawning a new one.`,
		z.tuple([zString]),
		async ([target]) => {
			const name = nameOf("agent-definition", target);
			return library.shows(name)
				? ((await library.source(name)) ?? null)
				: null;
		},
	);

	interp.def(
		"spawn",
		-1,
		'(spawn "name" [:prompt "..."] [:repl :fresh|:fork] [:chat :fresh|:fork])',
		"Start a sub-agent on a thread of its own under a name and return the name. Without :prompt it runs the saved definition of that name. With :prompt it is a temporary agent: nothing is saved, and a name a saved agent already holds is refused. agent-keep saves a temporary agent that proved worth reusing. :repl :fresh gives it a new image; :repl :fork gives it a copy of this one as it stands. :chat :fresh starts it with no conversation; :chat :fork starts it with a copy of this chat so far. Spawning a name again starts it over.",
		z.tuple([zList]),
		async ([rest]) => {
			const { values, options } = parse("spawn", rest, [
				"prompt",
				"repl",
				"chat",
				...DEFINE_KEYS,
				"permissions",
			]);
			if (values.length !== 1)
				throw new EvalException("spawn takes one name, then options", rest);
			const name = nameOf("spawn", values[0]);
			if (isDelegateName(name))
				throw new EvalException(
					`spawn: names starting ${DELEGATE_PREFIX} are kept for delegate`,
					name,
				);
			const seed = seedOf(interp, options.get("repl"));
			const chat = chatOf(options.get("chat"));
			const definition = await definitionOf(name, options);
			const child = await threads("spawn").spawn({ definition, seed, chat });
			handles.adopt(
				options.has("prompt")
					? { name, child, unsaved: writeDefinition(definition) }
					: { name, child },
			);
			return name;
		},
	);

	interp.def(
		KEEP,
		1,
		`(${KEEP} "name")`,
		`Save a temporary agent this session spawned with :prompt as ${AGENT_FOLDER}/<name>.ptc, so it can be spawned by name later. It waits on the user's approval. Keep one only when it did its work well and the same work will come again. Return the name.`,
		z.tuple([zString]),
		async ([target]) => {
			const name = nameOf(KEEP, target);
			const handle = handles.of(name);
			if (handle === undefined)
				throw new EvalException(`${KEEP}: no agent spawned by that name`, name);
			if (isDelegateName(name))
				throw new EvalException(`${KEEP}: a delegate cannot be kept`, name);
			if (handle.unsaved === undefined)
				throw new EvalException(`${KEEP}: that agent is saved already`, name);
			if ((await library.source(name)) !== undefined)
				throw new EvalException(
					`${KEEP}: a saved agent has that name already`,
					name,
				);
			await library.save(name, handle.unsaved);
			handles.adopt({ name, child: handle.child });
			return name;
		},
	);

	interp.def(
		FORGET,
		1,
		`(${FORGET} "name")`,
		`Delete the saved definition ${AGENT_FOLDER}/<name>.ptc. It waits on the user's approval. An agent already spawned from it keeps running. Return t when one was deleted, nil when none was saved.`,
		z.tuple([zString]),
		async ([target]) => {
			const name = nameOf(FORGET, target);
			return (await library.forget(name)) ? true : null;
		},
	);

	interp.def(
		"send",
		-1,
		'(send :to "name" "message" [:max-steps n])',
		"Hand a message to a spawned sub-agent and return its job id at once; keep working. Unless you agent-wait on it, its reply comes back later as a system event from agent:name, waking you if your turn ended.",
		z.tuple([zList]),
		async ([rest]) => {
			const { values, options } = parse("send", rest, ["to", "max-steps"]);
			if (values.length !== 1)
				throw new EvalException("send takes one message string", rest);
			const text = textOf("send", "the message", values[0]);
			const to = options.get("to");
			if (to === undefined)
				throw new EvalException("send: say who with :to", rest);
			const name = nameOf("send", to);
			const maxSteps = stepsOf("send", options);
			const child = handles.child(name);
			if (child === undefined)
				throw new EvalException(
					"send: no running agent by that name; spawn it first",
					name,
				);
			return await threads("send").send(child, { text, maxSteps });
		},
	);

	function stepsOf(form: string, options: Map<string, unknown>): number {
		const steps = options.get("max-steps");
		return steps === undefined
			? DEFAULT_MAX_STEPS
			: countOf(form, ":max-steps", steps);
	}

	interp.def(
		"delegate",
		-1,
		'(delegate "brief" [:max-steps n] [:repl :fresh|:fork])',
		"Hand self-contained work to a new temporary sub-agent with a fresh chat and return its job id at once; keep working. Its reply comes back later as a system event from agent:delegate-n, or agent-wait the job. The brief carries all it needs: goal, inputs, what done means. Nothing is saved and it cannot be kept.",
		z.tuple([zList]),
		async ([rest]) => {
			const { values, options } = parse("delegate", rest, [
				"max-steps",
				"repl",
			]);
			if (values.length !== 1)
				throw new EvalException("delegate takes one brief string", rest);
			const text = textOf("delegate", "the brief", values[0]);
			const maxSteps = stepsOf("delegate", options);
			const seed = seedOf(interp, options.get("repl"));
			const port = threads("delegate");
			const name = delegateName(handles.names());
			const child = await port.spawn({
				definition: { name, prompt: DELEGATE_PROMPT },
				seed,
				chat: { from: "fresh" },
			});
			handles.adopt({ name, child });
			return await port.send(child, { text, maxSteps });
		},
	);

	interp.def(
		"agent-wait",
		1,
		'(agent-wait "job")',
		"Wait in this step for a job to finish and return what the agent replied. A job you wait on sends no system event later. A failed, cancelled or lost job raises an error.",
		z.tuple([zString]),
		async ([job]) => {
			const port = threads("agent-wait");
			const waiting = interp.async.start((signal) => port.wait(job, signal));
			const outcome = (await interp.async.promiseOf(waiting)) as Outcome;
			if ("reply" in outcome) return outcome.reply;
			throw new EvalException(`job ${job}`, outcome.failure, false);
		},
	);

	interp.def(
		"agent-state",
		1,
		'(agent-state "job")',
		"Return where a job stands: :pending, :held, :done, :failed, :cancelled or :lost. A job the runtime lost to a restart reads :lost.",
		z.tuple([zString]),
		async ([job]) =>
			newLispKeyword((await threads("agent-state").state(job)).state),
	);

	interp.def(
		"agent-cancel",
		1,
		'(agent-cancel "job-or-name")',
		"Cancel a job that has not finished, or given a spawned agent's name, stop that agent and every agent under it. Return t when something was cancelled, nil otherwise.",
		z.tuple([zString]),
		async ([target]) => {
			const id = handles.child(target) ?? target;
			return (await threads("agent-cancel").cancel(id)) ? true : null;
		},
	);
}
