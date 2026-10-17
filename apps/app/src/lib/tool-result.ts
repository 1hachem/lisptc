export interface ToolEnvelope {
	output: string;
	error: boolean;
}

export function toolEnvelope(text: string): ToolEnvelope | undefined {
	try {
		const parsed = JSON.parse(text) as {
			type?: unknown;
			output?: unknown;
			error?: unknown;
		};
		if (parsed?.type !== "tool_result") return undefined;
		return {
			output: String(parsed.output ?? ""),
			error: Boolean(parsed.error),
		};
	} catch {
		return undefined;
	}
}
