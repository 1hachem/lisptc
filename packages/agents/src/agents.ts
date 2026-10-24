import { effect } from "@repo/interpreter/effects";
import { EvalException } from "@repo/interpreter/errors";
import { snapshot } from "@repo/interpreter/image";
import { type Interp, runSync } from "@repo/interpreter/lisp";
import {
	Cell,
	LispKeyword,
	type List,
	newSym,
} from "@repo/interpreter/objects";
import { keyName } from "@repo/interpreter/plist";
import { zList } from "@repo/interpreter/schema";
import type { InterpExtension, SessionHooks } from "@repo/interpreter/session";
import type { PromptSource } from "@repo/shared/host";
import { z } from "zod";
import type {
	AgentDefinition,
	AgentDefinitions,
	AgentRunner,
	ChatSeed,
	Notice,
	ReplSeed,
	SubAgent,
} from "./ports.ts";

export interface AgentsHost {
	prompt: PromptSource;
	definitions: AgentDefinitions;
	runner?: AgentRunner;
	notify?: (notice: Notice) => void;
}

export const DEFAULT_MAX_STEPS = 20;

export const BOUNDED_DEFINE = "agents/define-bounded";

export interface AgentsExtension extends InterpExtension {
	readonly asks: readonly string[];
}

export function agentsExtension(host: AgentsHost): AgentsExtension {
	const stepping = { depth: 0 };
	return Object.assign(
		(interp: Interp): void => registerAgents(interp, host, stepping),
		{
			prompt: host.prompt(),
			asks: [BOUNDED_DEFINE],
			session(hooks: SessionHooks): void {
				hooks.evalStep.use(async (ctx, next) => {
					stepping.depth++;
					try {
						await next(ctx);
					} finally {
						stepping.depth--;
					}
				});
			},
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

function failureOf(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

interface Running {
	readonly agent: SubAgent;
	queue: Promise<unknown>;
}

export function registerAgents(
	interp: Interp,
	host: AgentsHost,
	stepping: { readonly depth: number } = { depth: 0 },
): void {
	const running = new Map<string, Running>();

	function runner(): AgentRunner {
		if (host.runner === undefined)
			throw new EvalException(
				"this session runs no sub-agents",
				"spawn",
				false,
			);
		return host.runner;
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
		'(spawn "name" [:prompt "..."] [:repl :fresh|:fork] [:chat :fresh|:fork])',
		"Start a sub-agent under a name and return the name. Without :prompt it runs the saved definition of that name. :repl :fresh gives it a new image; :repl :fork gives it a copy of this one as it stands. :chat :fresh starts it with no conversation; :chat :fork starts it with a copy of this chat so far. Spawning a name again starts it over.",
		z.tuple([zList]),
		async ([rest]) => {
			const { values, options } = parse("spawn", rest, [
				"prompt",
				"repl",
				"chat",
			]);
			if (values.length !== 1)
				throw new EvalException("spawn takes one name, then options", rest);
			const name = nameOf("spawn", values[0]);
			const seed = seedOf(interp, options.get("repl"));
			const chat = chatOf(options.get("chat"));
			const definition = await definitionOf(name, options.get("prompt"));
			running.set(name, {
				agent: runner().spawn({ definition, seed, chat }),
				queue: Promise.resolve(),
			});
			return name;
		},
	);

	interp.def(
		"send",
		-1,
		'(send :to "name" "message" [:max-steps n])',
		"Send a message to a spawned sub-agent. Return a promise of its reply right away and keep working. Wait with await to have the reply in this step. A reply that lands outside a step comes back as a system event from agent:name, waking you if your turn ended. Messages to one agent run in turn.",
		z.tuple([zList]),
		([rest]) => {
			const { values, options } = parse("send", rest, ["to", "max-steps"]);
			if (values.length !== 1)
				throw new EvalException("send takes one message string", rest);
			const message = textOf("send", "the message", values[0]);
			const to = options.get("to");
			if (to === undefined)
				throw new EvalException("send: say who with :to", rest);
			const name = nameOf("send", to);
			const maxSteps = stepsOf(options.get("max-steps"));
			const target = running.get(name);
			if (target === undefined)
				throw new EvalException(
					"send: no running agent by that name; spawn it first",
					name,
				);
			return interp.async.start((signal) => {
				const sent = target.queue
					.catch(() => undefined)
					.then(() => target.agent.send({ message, maxSteps, signal }))
					.catch((error: unknown) => {
						throw new EvalException(`agent ${name}`, failureOf(error), false);
					});
				target.queue = sent;
				sent.then(
					(reply) => {
						if (stepping.depth === 0)
							host.notify?.({ agent: name, reply: String(reply) });
					},
					(error: unknown) => {
						if (stepping.depth === 0)
							host.notify?.({
								agent: name,
								failure: failureOf(error),
							});
					},
				);
				return sent;
			});
		},
	);
}
