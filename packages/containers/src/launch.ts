import type {
	AppContainer,
	CommandEntry,
	ImageEntry,
	LaunchedEntry,
	RemoteEntry,
	Resources,
	SecretRef,
} from "@repo/toolkit";

export interface Launch {
	image: string;
	exposed: string;
	path: string;
	args: string[];
}

export interface RunSpec {
	name: string;
	launch: Launch;
	app?: AppContainer;
	env?: Readonly<Record<string, string>>;
	secret?: SecretRef;
	resources?: Resources;
}

type Entry = RemoteEntry | LaunchedEntry | ImageEntry | CommandEntry;

const GATEWAY_IMAGE = "supercorp/supergateway:3.4.3";
const GATEWAY_PORT = "8000";
const MCP_PATH = "/mcp";

function shellQuote(word: string): string {
	return /^[\w@%+=:,./-]+$/.test(word)
		? word
		: `'${word.replaceAll("'", `'\\''`)}'`;
}

export function retagged(image: string, tag: string | undefined): string {
	if (!tag || image.includes("@")) return image;
	return `${image.replace(/:[^:/]+$/, "")}:${tag}`;
}

function ownImage(entry: ImageEntry, tag: string | undefined): string {
	return entry.internal ? retagged(entry.image, tag) : entry.image;
}

export function imagesOf(entry: Entry, tag?: string): string[] {
	if (!("image" in entry)) return [];
	const own = ownImage(entry, tag);
	return entry.app ? [own, entry.app.image] : [own];
}

export function launchFor(entry: Entry, tag?: string): Launch | undefined {
	if ("image" in entry)
		return {
			image: ownImage(entry, tag),
			exposed: String(entry.port),
			path: entry.path ?? MCP_PATH,
			args: entry.command ? [] : (entry.args ?? []),
		};
	if ("url" in entry) return undefined;
	return {
		image: GATEWAY_IMAGE,
		exposed: GATEWAY_PORT,
		path: MCP_PATH,
		args: [
			"--stdio",
			[entry.command, ...(entry.args ?? [])].map(shellQuote).join(" "),
			"--outputTransport",
			"streamableHttp",
			"--stateful",
			"--port",
			GATEWAY_PORT,
			"--streamableHttpPath",
			MCP_PATH,
		],
	};
}

export function runSpecFor(
	entry: ImageEntry | CommandEntry,
	tag?: string,
): RunSpec;
export function runSpecFor(entry: Entry, tag?: string): RunSpec | undefined;
export function runSpecFor(entry: Entry, tag?: string): RunSpec | undefined {
	const launch = launchFor(entry, tag);
	if (launch === undefined) return undefined;
	return {
		name: entry.name,
		launch,
		...("app" in entry && entry.app ? { app: entry.app } : {}),
		...("env" in entry && entry.env ? { env: entry.env } : {}),
		...("secret" in entry && entry.secret ? { secret: entry.secret } : {}),
		...("resources" in entry && entry.resources
			? { resources: entry.resources }
			: {}),
	};
}
