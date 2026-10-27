import { effect } from "@repo/interpreter/effects";
import { EvalException } from "@repo/interpreter/errors";
import { implant, snapshot } from "@repo/interpreter/image";
import { type Interp, runSync } from "@repo/interpreter/lisp";
import {
	arrayToList,
	Cell,
	LispKeyword,
	type List,
	listToArray,
	newLispKeyword,
	newSym,
	Sym,
} from "@repo/interpreter/objects";
import { keyName } from "@repo/interpreter/plist";
import { readFailure } from "@repo/interpreter/reader";
import { zList, zString } from "@repo/interpreter/schema";
import type { InterpExtension, SessionHooks } from "@repo/interpreter/session";
import { output } from "@repo/interpreter/topics";
import type { PromptSource, SourceFolder } from "@repo/shared/host";
import { z } from "zod";
import { AGENT_FOLDER, writeDefinition } from "./definition.ts";
import {
	EXPORTS_GLOBAL,
	EXPORTS_STATE,
	type Export,
	exportsCodec,
	listed,
} from "./exports.ts";
import { Handles, handlesCodec } from "./handles.ts";
import { AgentLibrary } from "./library.ts";
import { DELEGATE_PREFIX, delegateName, isDelegateName } from "./names.ts";
import {
	type AgentDefinition,
	type AgentThreads,
	type ChatSeed,
	type Outcome,
	PARENT_NAME,
	type ReplSeed,
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

export interface SubAgentHost {
	prompt: PromptSource;
}

export const EXPORT = "agents/export";

export const TAKE = "agent-take";

export interface AgentsExtension extends InterpExtension {
	readonly asks: readonly string[];
}

export function agentsExtension(host: AgentsHost): AgentsExtension {
	return Object.assign((interp: Interp): void => registerAgents(interp, host), {
		prompt: host.prompt(),
		asks: [DEFINE, BOUNDED_DEFINE, KEEP, FORGET],
	});
}

export function subAgentExtension(host: SubAgentHost): InterpExtension {
	return Object.assign((interp: Interp): void => registerExports(interp), {
		prompt: host.prompt(),
		session(hooks: SessionHooks): void {
			hooks.answer.use((interp, code, next) =>
				withExports(interp, next(interp, code)),
			);
		},
	});
}

function exportsOf(interp: Interp): readonly Export[] {
	return exportsCodec.fromLisp(interp.getGlobal(newSym(EXPORTS_GLOBAL)));
}

function withExports(interp: Interp, answer: string): string {
	const exports = exportsOf(interp);
	if (exports.length === 0) return answer;
	return `${answer}\n\nexports, take with (${TAKE} "agent" 'name):\n${listed(exports)}`;
}

function symbolName(form: string, value: unknown): string {
	if (value instanceof Sym) return value.name;
	throw new EvalException(
		`${form}: name the value with a quoted symbol`,
		value,
	);
}

function registerExports(interp: Interp): void {
	const exports = interp.state(
		EXPORTS_STATE,
		exportsCodec,
		[],
		"The values this sub-agent hands its parent, by name, with what each holds.",
	);
	interp.def(
		EXPORT,
		2,
		`(${EXPORT} 'name "what it holds")`,
		`Offer the global bound to name to the agent that spawned you, described for it: what it is and its shape. Your final answer lists every export, and that agent copies one with ${TAKE} when it wants it, as the value stands then. Exporting a name again replaces its description. Return the name.`,
		z.tuple([z.unknown(), zString]),
		([value, description]) => {
			const name = symbolName(EXPORT, value);
			if (interp.getGlobal(value as Sym) === undefined)
				throw new EvalException(
					`${EXPORT}: bind it before exporting it`,
					value,
				);
			exports.set([
				...exports.get().filter((entry) => entry.name !== name),
				{ name, description },
			]);
			return value;
		},
	);
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
			"The names of the sub-agents this session spawned, with the definition of each one not saved yet.",
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
			handles.saved(name);
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
		"spawned",
		0,
		"(spawned)",
		"Return the names of the agents this session spawned or delegated, saved or temporary, finished or not. send, agent-wait, agent-state, agent-take and agent-cancel take these names. (agents) lists saved definitions only.",
		z.tuple([]),
		() => arrayToList(handles.names()),
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
		"Start a sub-agent on a thread of its own under a name, print the name, and return it. A name is unique in this session: one spawned or delegated already is refused, finished or not. Without :prompt it runs the saved definition of that name. With :prompt it is a temporary agent that starts at once on that prompt; its reply comes back later as a system event from agent:name. Nothing is saved, and a name a saved agent already holds is refused. agent-keep saves a temporary agent that proved worth reusing. :repl :fresh gives it a new image; :repl :fork gives it a copy of this one as it stands. :chat :fresh starts it with no conversation; :chat :fork starts it with a copy of this chat so far.",
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
			if (name === PARENT_NAME)
				throw new EvalException(
					`spawn: ${PARENT_NAME} is what a sub-agent calls this session`,
					name,
				);
			if (handles.of(name) !== undefined)
				throw new EvalException(
					"spawn: an agent of that name is spawned already; send to it, or spawn a new one under another name",
					name,
				);
			const seed = seedOf(interp, options.get("repl"));
			const chat = chatOf(options.get("chat"));
			const definition = await definitionOf(name, options);
			const port = threads("spawn");
			await port.spawn({ definition, seed, chat });
			if (!options.has("prompt")) {
				handles.adopt({ name });
				return announce(`spawned ${name}`, name);
			}
			handles.adopt({ name, unsaved: writeDefinition(definition) });
			await port.send(name, {
				text: definition.prompt,
				maxSteps: DEFAULT_MAX_STEPS,
			});
			return announce(`spawned ${name}`, name);
		},
	);

	function announce(line: string, name: string): string {
		output.emit(interp.channels, { user: `${line}\n`, model: `${line}\n` });
		return name;
	}

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
			handles.saved(name);
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
		"Hand a message to a spawned sub-agent and return its name at once; keep working. Unless you agent-wait on it, its reply comes back later as a system event from agent:name, waking you if your turn ended.",
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
			if (handles.of(name) === undefined)
				throw new EvalException(
					"send: no running agent by that name; spawn it first",
					name,
				);
			await threads("send").send(name, { text, maxSteps });
			return name;
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
		"Hand self-contained work to a new temporary sub-agent with a fresh chat, print its name, and return the name at once; keep working. Its reply comes back later as a system event from agent:delegate-n, or agent-wait that name. The brief carries all it needs: goal, inputs, what done means. Nothing is saved and it cannot be kept.",
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
			await port.spawn({
				definition: { name, prompt: DELEGATE_PROMPT },
				seed,
				chat: { from: "fresh" },
			});
			handles.adopt({ name });
			await port.send(name, { text, maxSteps });
			return announce(`delegated to ${name}`, name);
		},
	);

	function spawnedName(form: string, target: unknown): string {
		const name = nameOf(form, target);
		if (handles.of(name) === undefined)
			throw new EvalException(
				`${form}: no agent spawned by that name; (spawned) lists them`,
				name,
			);
		return name;
	}

	interp.def(
		"agent-wait",
		1,
		'(agent-wait "name")',
		"Wait in this step for the last message sent to that agent to finish and return what it replied. A message you wait on sends no system event later. A failed, cancelled or lost one raises an error, and so does an agent sent nothing since the runtime started.",
		z.tuple([zString]),
		async ([target]) => {
			const name = spawnedName("agent-wait", target);
			const port = threads("agent-wait");
			const waiting = interp.async.start((signal) => port.wait(name, signal));
			const outcome = (await interp.async.promiseOf(waiting)) as Outcome;
			if ("reply" in outcome) return outcome.reply;
			throw new EvalException(name, outcome.failure, false);
		},
	);

	async function read(agent: string, name: string): Promise<unknown> {
		try {
			return implant(interp, await threads(TAKE).read(agent, name));
		} catch (error) {
			if (error instanceof EvalException) throw error;
			const reason = error instanceof Error ? error.message : String(error);
			throw new EvalException(`${TAKE}: ${reason}`, name, false);
		}
	}

	interp.def(
		TAKE,
		2,
		`(${TAKE} "name" 'value)`,
		`Copy a value a spawned or delegated agent exported into this session and return it; bind it where you want. Its reply lists what it exports. A function comes with its captured variables, and calls the globals it names by name here.`,
		z.tuple([zString, z.unknown()]),
		async ([target, value]) => {
			const name = spawnedName(TAKE, target);
			const wanted = symbolName(TAKE, value);
			const offered = exportsCodec.fromLisp(await read(name, EXPORTS_GLOBAL));
			if (!offered.some((entry) => entry.name === wanted))
				throw new EvalException(
					`${TAKE}: ${name} exports ${offered.map((entry) => entry.name).join(" ") || "nothing"}`,
					value,
				);
			return await read(name, wanted);
		},
	);

	interp.def(
		"agent-state",
		1,
		'(agent-state "name")',
		"Return where the last message sent to that agent stands: :pending, :held, :done, :failed, :cancelled or :lost, or :idle when it was sent nothing since the runtime started.",
		z.tuple([zString]),
		async ([target]) => {
			const name = spawnedName("agent-state", target);
			return newLispKeyword((await threads("agent-state").state(name)).state);
		},
	);

	interp.def(
		"agent-cancel",
		1,
		'(agent-cancel "name")',
		"Stop that agent and every agent under it. Return t when something was cancelled, nil otherwise.",
		z.tuple([zString]),
		async ([target]) => {
			const name = spawnedName("agent-cancel", target);
			return (await threads("agent-cancel").cancel(name)) ? true : null;
		},
	);
}
