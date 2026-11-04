import { type PermissionRule, permissionRules } from "./files.ts";
import { callOf, type Datum, plainText, readForm } from "./form-reader.ts";

export interface Definition {
	name: string;
	prompt: string;
	budget: string | undefined;
	roster: string[] | undefined;
	rules: PermissionRule[];
}

function listOf(datum: Datum): string[] {
	return datum.kind === "list"
		? datum.items.map(plainText)
		: [plainText(datum)];
}

export function definitionOf(text: string): Definition | undefined {
	const call = callOf(readForm(text));
	const name = call?.args[0];
	if (call?.head !== "defagent" || name?.kind !== "string") return undefined;
	const option = (key: string) => call.options.get(key);
	const permissions = option("permissions");
	const roster = option("roster");
	const budget = option("budget");
	const prompt = option("prompt");
	return {
		name: name.value,
		prompt: prompt === undefined ? "" : plainText(prompt),
		budget: budget && plainText(budget),
		roster: roster && listOf(roster),
		rules:
			permissions?.kind === "string" ? permissionRules(permissions.value) : [],
	};
}
