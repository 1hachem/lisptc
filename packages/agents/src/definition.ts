import type { Interp } from "@repo/interpreter/lisp";
import { Cell, type List } from "@repo/interpreter/objects";
import { parsePlist } from "@repo/interpreter/plist";
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
	const { name, prompt, permissions, budget } = definition;
	const lines = [
		`(defagent ${JSON.stringify(name)}`,
		`  :prompt ${JSON.stringify(prompt)}`,
	];
	if (permissions !== undefined)
		lines.push(`  :permissions ${JSON.stringify(permissions)}`);
	if (budget !== undefined) lines.push(`  :budget ${budget}`);
	return `${lines.join("\n")})`;
}

export function readDefinition(
	interp: Interp,
	text: string,
): AgentDefinition | undefined {
	try {
		const form = interp.read(text);
		if (!(form instanceof Cell) || !(form.cdr instanceof Cell))
			return undefined;
		const name = form.cdr.car;
		const options = parsePlist(form.cdr.cdr as List);
		const prompt = options.get("prompt");
		if (typeof name !== "string" || typeof prompt !== "string")
			return undefined;
		const permissions = options.get("permissions");
		const budget = Number(options.get("budget"));
		return {
			name,
			prompt,
			...(typeof permissions === "string" ? { permissions } : {}),
			...(Number.isInteger(budget) && budget > 0 ? { budget } : {}),
		};
	} catch {
		return undefined;
	}
}
