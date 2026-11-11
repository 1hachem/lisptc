export type {
	AppContainer,
	CommandEntry,
	EntryMeta,
	ImageEntry,
	IssuerOAuth,
	LaunchedEntry,
	MachineEntry,
	NamedPort,
	ProductionEntry,
	RemoteEntry,
	ResourceAmounts,
	Resources,
	SecretRef,
	ToolkitEntry,
} from "./entry.ts";
export { devEntries } from "./mcp.toolkit.dev.ts";
export { machineEntries } from "./mcp.toolkit.local.ts";
export { bundledEntries } from "./mcp.toolkit.ts";

export const TOOLKIT_ROOT = new URL(
	import.meta.url.endsWith(".ts") ? "../" : "./",
	import.meta.url,
);
