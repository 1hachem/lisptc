import type {
	OAuthClientInformationFull,
	OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";

export interface JsonSchema {
	type?: string;
	properties?: Record<string, JsonSchema>;
	required?: string[];
	enum?: unknown[];
	description?: string;
	items?: JsonSchema;
	default?: unknown;
	examples?: unknown[];
}

export interface Icon {
	src: string;
	mimeType?: string;
	sizes?: string[];
	theme?: "light" | "dark";
}

export interface Tool {
	name: string;
	title?: string;
	description?: string;
	annotations?: { title?: string };
	inputSchema?: JsonSchema;
	outputSchema?: JsonSchema;
	icons?: Icon[];
}

export interface ConnMeta {
	description?: string;
	keywords?: string[];
	icon?: string;
}

export interface ResourceAmounts {
	cpu?: string;
	memory?: string;
}

export interface Resources {
	requests?: ResourceAmounts;
	limits?: ResourceAmounts;
}

export interface IssuerOAuth {
	issuer: string;
	authorize: string;
	token: string;
	client: string;
	params?: Record<string, string>;
}

export type HttpConnConfig = ConnMeta & {
	name: string;
	url: string;
	headers?: Record<string, string>;
	oauth?: boolean | IssuerOAuth;
	scopes?: string[];
	command?: string;
	args?: string[];
	env?: Record<string, string>;
};

export type Reclaim = "Retain" | "Delete";

export interface StateEntry {
	name?: string;
	path: string;
	size?: string;
	reclaim?: Reclaim;
	retentionSeconds?: number;
}

export type StateSpec = string | StateEntry | (string | StateEntry)[];

export interface NamedPort {
	name: string;
	port: number;
}

export interface AppContainer {
	image: string;
	args?: string[];
	ports?: NamedPort[];
	expose?: string[];
	resources?: Resources;
	state?: StateSpec;
}

export interface SecretRef {
	name: string;
	keys: string[];
}

export type ContainerConnConfig = ConnMeta & {
	name: string;
	image: string;
	internal?: boolean;
	port: number;
	path?: string;
	command?: string;
	args?: string[];
	headers?: Record<string, string>;
	env?: Record<string, string>;
	secret?: SecretRef;
	oauth?: IssuerOAuth;
	scopes?: string[];
	resources?: Resources;
	state?: StateSpec;
	app?: AppContainer;
	flags?: Record<string, string[]>;
};

export type StdioConnConfig = ConnMeta & {
	name: string;
	command: string;
	args?: string[];
	env?: Record<string, string>;
	resources?: Resources;
	local?: boolean;
	flags?: Record<string, string[]>;
};

export type ConnConfig = HttpConnConfig | ContainerConnConfig | StdioConnConfig;

export type OAuthConnConfig = HttpConnConfig | ContainerConnConfig;

export interface ConnectResult {
	serverId: string;
	tools: Tool[];
	icons?: Icon[];
}

export interface ToolCall {
	serverId: string;
	tool: string;
	args: Record<string, unknown>;
	timeoutMs?: number;
}

export interface McpClient {
	connect(conf: ConnConfig, watch?: StartWatch): Promise<ConnectResult>;
	callTool(call: ToolCall, signal?: AbortSignal): Promise<unknown>;
	disconnect(serverId: string): Promise<void>;
	asleep(serverId: string): Promise<boolean>;
	login(conf: OAuthConnConfig): Promise<{ authUrl: string | null }>;
	logout(conf: OAuthConnConfig): Promise<void>;
	authorize(conf: OAuthConnConfig, code: string): Promise<void>;
	shutdown(): Promise<void>;
}

export class AuthorizationRequired extends Error {
	constructor(
		readonly server: string,
		readonly url: string,
		captured: boolean,
	) {
		super(
			captured
				? `authorization required for "${server}": open ${url} — after approving it will be captured automatically, then run (load-mcp "${server}") again (or run (mcp-authorize "${server}" "<code>"))`
				: `authorization required for "${server}": open ${url} — once the user says they approved it, run (load-mcp "${server}") again (or, if they hand back a code instead, run (mcp-authorize "${server}" "<code>") first)`,
		);
	}
}

export interface McpTransport {
	start(): Promise<void>;
	send(message: unknown): Promise<void>;
	close(): Promise<void>;
	onmessage?: (message: unknown) => void;
	onclose?: () => void;
	onerror?: (error: Error) => void;
}

export interface AddressHandle {
	url: string;
	headers?: Record<string, string>;
}

export interface TransportHandle {
	transport(): McpTransport;
}

export type ServerHandle = AddressHandle | TransportHandle;

export type ServerState = "running" | "stopped" | "unknown";

export type ServerPhase = "starting" | "ready" | "sleeping" | "failed";

export interface ServerReport {
	server: string;
	phase: ServerPhase;
	reason?: string;
}

export type ServerReporter = (report: ServerReport) => void;

export interface StartWatch {
	signal?: AbortSignal;
	progress?: (note: string) => void;
}

export interface McpHost {
	ensure(
		conf: ConnConfig,
		watch?: StartWatch,
	): Promise<ServerHandle | undefined>;
	stop(name: string): Promise<void>;
	stopAll(): Promise<void>;
	status(name: string): ServerState;
	logs(name: string): string;
	used(name: string): void;
	asleep(name: string): Promise<boolean>;
}

export interface UserMachine {
	refresh(): Promise<boolean>;
	connected(): boolean;
	servers(): readonly string[];
}

export interface ToolkitRegistry {
	all(): ConnConfig[];
	local?(name: string): StdioConnConfig | undefined;
}

export interface McpMount {
	readonly server: string;
	readonly conf?: HttpConnConfig;
	readonly tools: readonly Tool[];
}

export interface McpRegistry {
	mounts(): readonly McpMount[] | Promise<readonly McpMount[]>;
	mount(mount: McpMount): void | Promise<void>;
	unmount(server: string): void | Promise<void>;
}

export function memoryRegistry(): McpRegistry {
	const mounted = new Map<string, McpMount>();
	return {
		mounts: () => [...mounted.values()],
		mount: (mount) => {
			mounted.set(mount.server, mount);
		},
		unmount: (server) => {
			mounted.delete(server);
		},
	};
}

export type ServerAccess =
	| { readonly access: "open" }
	| { readonly access: "hidden" }
	| { readonly access: "denied"; readonly reason?: string };

export interface McpPolicy {
	server(name: string): ServerAccess;
	tool(server: string, tool: string): boolean;
}

export const openPolicy: McpPolicy = {
	server: () => ({ access: "open" }),
	tool: () => true,
};

export interface PendingAuthorization {
	state: string;
	serverUrl: string;
	scope?: string;
	oauth?: IssuerOAuth;
}

export interface OAuthRecord {
	clientInformation?: OAuthClientInformationFull;
	tokens?: OAuthTokens;
	expiresAt?: number;
	codeVerifier?: string;
	pending?: PendingAuthorization;
}

export interface OAuthClient {
	client_id: string;
	client_secret: string;
}

export type OAuthClients = Record<string, OAuthClient>;

export interface OAuthStore {
	load(serverKey: string): Promise<OAuthRecord | undefined>;
	save(serverKey: string, record: OAuthRecord): Promise<void>;
	clear(serverKey: string): Promise<void>;
}

export interface EnvLookup {
	get(name: string): string | undefined;
}
