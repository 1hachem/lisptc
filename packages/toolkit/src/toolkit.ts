export const TOOLKIT_URL = new URL(
	import.meta.url.endsWith(".ts")
		? "../mcp.toolkit.json"
		: "./mcp.toolkit.json",
	import.meta.url,
);
