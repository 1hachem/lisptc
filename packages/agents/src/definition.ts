import { Cell, type List, listToArray, Sym } from "@repo/interpreter/objects";
import { parsePlist } from "@repo/interpreter/plist";
import { Reader } from "@repo/interpreter/reader";
import type { AgentDefinition } from "./ports.ts";

export const AGENT_FOLDER = "sub-agents";

const EXTENSION = ".ptc";

export function agentFileName(name: string): string {
	return `${name}${EXTENSION}`;
}

export function agentNameOf(file: string): string | undefined {
	return file.endsWith(EXTENSION)
		? file.slice(0, -EXTENSION.length)
		: undefined;
}

export function writeDefinition(definition: AgentDefinition): string {
	const { name, prompt, permissions, roster, budget } = definition;
	const lines = [
		`(defagent ${JSON.stringify(name)}`,
		`  :prompt ${JSON.stringify(prompt)}`,
	];
	if (permissions !== undefined)
		lines.push(`  :permissions ${JSON.stringify(permissions)}`);
	if (roster !== undefined)
		lines.push(
			`  :roster '(${roster.map((member) => JSON.stringify(member)).join(" ")})`,
		);
	if (budget !== undefined) lines.push(`  :budget ${budget}`);
	return `${lines.join("\n")})`;
}

function unquoted(value: unknown): unknown {
	if (
		value instanceof Cell &&
		value.car instanceof Sym &&
		value.car.name === "quote" &&
		value.cdr instanceof Cell
	)
		return value.cdr.car;
	return value;
}

function rosterOf(value: unknown): readonly string[] | undefined {
	const list = unquoted(value);
	if (list !== null && !(list instanceof Cell)) return undefined;
	const members = listToArray(list);
	return members.every((member) => typeof member === "string")
		? members
		: undefined;
}

export function readDefinition(text: string): AgentDefinition | undefined {
	try {
		const reader = new Reader();
		reader.push(text);
		const form = reader.read();
		if (!(form instanceof Cell) || !(form.cdr instanceof Cell))
			return undefined;
		const name = form.cdr.car;
		const options = parsePlist(form.cdr.cdr as List);
		const prompt = options.get("prompt");
		if (typeof name !== "string" || typeof prompt !== "string")
			return undefined;
		const permissions = options.get("permissions");
		const roster = options.has("roster")
			? rosterOf(options.get("roster"))
			: undefined;
		const budget = Number(options.get("budget"));
		return {
			name,
			prompt,
			...(typeof permissions === "string" ? { permissions } : {}),
			...(roster === undefined ? {} : { roster }),
			...(Number.isInteger(budget) && budget > 0 ? { budget } : {}),
		};
	} catch {
		return undefined;
	}
}
