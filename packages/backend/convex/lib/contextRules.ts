export interface ContextChange {
	key: string;
	told: string | undefined;
	state: string;
	detail?: string;
}

export type ContextRule = (change: ContextChange) => string | undefined;

function mcpPhase({ key, state, detail }: ContextChange): string | undefined {
	const again = `Run (load-mcp "${key}") again before calling them.`;
	if (state === "sleeping")
		return `The MCP server "${key}" was stopped after going unused, and its ${key}/* tools are no longer defined. ${again}`;
	if (state === "failed")
		return `The MCP server "${key}" failed${detail === undefined ? "" : ` (${detail})`}, and its ${key}/* tools no longer answer. ${again}`;
	return undefined;
}

export const CONTEXT_RULES: Readonly<Record<string, ContextRule>> = {
	mcp: mcpPhase,
};

export function contextRule(source: string): ContextRule {
	const rule = CONTEXT_RULES[source];
	if (rule === undefined)
		throw new Error(`no context rule is registered for "${source}"`);
	return rule;
}
