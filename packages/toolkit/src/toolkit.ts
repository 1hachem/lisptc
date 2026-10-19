import manifest from "../mcp.toolkit.json" with { type: "json" };

export interface Toolkit {
	name: string;
	description?: string;
}

export const TOOLKIT_URL = new URL(
	import.meta.url.endsWith(".ts")
		? "../mcp.toolkit.json"
		: "./mcp.toolkit.json",
	import.meta.url,
);

export const toolkits: readonly Toolkit[] = manifest.map(
	({ name, description }) => ({ name, description }),
);
