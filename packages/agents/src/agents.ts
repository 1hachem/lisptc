import { effect } from "@repo/interpreter/effects";
import { EvalException } from "@repo/interpreter/errors";
import { snapshot } from "@repo/interpreter/image";
import type { Interp } from "@repo/interpreter/lisp";
import { Cell, LispKeyword, type List } from "@repo/interpreter/objects";
import { keyName } from "@repo/interpreter/plist";
import { zList } from "@repo/interpreter/schema";
import type { InterpExtension } from "@repo/interpreter/session";
import type { PromptSource } from "@repo/shared/host";
import { z } from "zod";
import type {
	AgentDefinition,
	AgentDefinitions,
	AgentRunner,
	ReplSeed,
	SubAgent,
} from "./ports.ts";

export interface AgentsHost {
	prompt: PromptSource;
	definitions: AgentDefinitions;
	runner?: AgentRunner;
}

export const DEFAULT_MAX_STEPS = 20;

export function agentsExtension(host: AgentsHost): InterpExtension {
	return Object.assign((interp: Interp): void => registerAgents(interp, host), {
		prompt: host.prompt(),
	});
}

function lastOf(values: List): unknown {
	let last: unknown = null;
	for (let at: unknown = values; at instanceof Cell; at = at.cdr) last = at.car;
	return last;
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

interface Running {
	readonly agent: SubAgent;
	queue: Promise<unknown>;
}

export function registerAgents(interp: Interp, host: AgentsHost): void {
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
		"quietly",
		-1,
		"(quietly form...)",
		"Run the forms of a message without handing the message to the agent. The message and what the forms printed stay in the chat, so the agent reads them on its next turn. Return the value of the last form.",
		z.tuple([zList]),
		([forms]) => {
			effect.emit(interp.channels, { harness: { type: "quiet" } });
			return lastOf(forms);
		},
	);

	interp.def(
		"defagent",
		-1,
		'(defagent "name" :prompt "...")',
		"Save an agent definition under a name, replacing one of the same name. Spawn it later by that name. Return the name.",
		z.tuple([zList]),
		async ([rest]) => {
			const { values, options } = parse("defagent", rest, ["prompt"]);
			if (values.length !== 1)
				throw new EvalException("defagent takes one name, then :prompt", rest);
			const name = nameOf("defagent", values[0]);
			const prompt = textOf("defagent", ":prompt", options.get("prompt"));
			await host.definitions.put({ name, prompt });
			return name;
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
		'(spawn "name" [:prompt "..."] [:repl :fresh|:fork])',
		"Start a sub-agent under a name and return the name. Without :prompt it runs the saved definition of that name. :repl :fresh gives it a new image; :repl :fork gives it a copy of this one as it stands. Spawning a name again starts it over.",
		z.tuple([zList]),
		async ([rest]) => {
			const { values, options } = parse("spawn", rest, ["prompt", "repl"]);
			if (values.length !== 1)
				throw new EvalException("spawn takes one name, then options", rest);
			const name = nameOf("spawn", values[0]);
			const seed = seedOf(interp, options.get("repl"));
			const definition = await definitionOf(name, options.get("prompt"));
			running.set(name, {
				agent: runner().spawn({ definition, seed }),
				queue: Promise.resolve(),
			});
			return name;
		},
	);

	interp.def(
		"send",
		-1,
		'(send :to "name" "message" [:max-steps n])',
		"Send a message to a spawned sub-agent. Return a promise of its reply right away; poll it with promise-state or wait with await. Messages to one agent run in turn.",
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
						throw new EvalException(
							`agent ${name}`,
							error instanceof Error ? error.message : error,
							false,
						);
					});
				target.queue = sent;
				return sent;
			});
		},
	);
}
