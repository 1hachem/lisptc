export const AGENT_FOLDER = "sub-agents";

export function agentFileName(name: string): string {
	return `${name}.ptc`;
}

export function agentSource(agent: {
	name: string;
	prompt: string;
	permissions?: string | undefined;
}): string {
	const lines = [
		`(defagent ${JSON.stringify(agent.name)}`,
		`  :prompt ${JSON.stringify(agent.prompt)}`,
	];
	if (agent.permissions !== undefined)
		lines.push(`  :permissions ${JSON.stringify(agent.permissions)}`);
	return `${lines.join("\n")})`;
}
