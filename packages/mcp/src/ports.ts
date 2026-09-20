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

export interface Tool {
	name: string;
	description?: string;
	inputSchema?: JsonSchema;
	outputSchema?: JsonSchema;
}

interface ConnMeta {
	description?: string;
	keywords?: string[];
}

export type HttpConnConfig = ConnMeta & {
	name: string;
	url: string;
	headers?: Record<string, string>;
	oauth?: boolean;
	scopes?: string[];
	command?: string;
	args?: string[];
	env?: Record<string, string>;
};

export type ContainerConnConfig = ConnMeta & {
	name: string;
	image: string;
	port: number;
	path?: string;
	command?: string;
	args?: string[];
	headers?: Record<string, string>;
	env?: Record<string, string>;
};

export type StdioConnConfig = ConnMeta & {
	name: string;
	command: string;
	args?: string[];
	env?: Record<string, string>;
};

export type ConnConfig = HttpConnConfig | ContainerConnConfig | StdioConnConfig;

export interface ConnectResult {
	serverId: string;
	tools: Tool[];
}

export interface ToolCall {
	serverId: string;
	tool: string;
	args: Record<string, unknown>;
}

export interface McpClient {
	connect(conf: ConnConfig, signal?: AbortSignal): Promise<ConnectResult>;
	callTool(call: ToolCall, signal?: AbortSignal): Promise<unknown>;
	disconnect(serverId: string): Promise<void>;
	login(conf: HttpConnConfig): Promise<{ authUrl: string | null }>;
	logout(conf: HttpConnConfig): Promise<void>;
	authorize(conf: HttpConnConfig, code: string): Promise<void>;
	shutdown(): Promise<void>;
}

export interface ServerHandle {
	url: string;
	headers?: Record<string, string>;
}

export type ServerState = "running" | "stopped" | "unknown";

export interface McpHost {
	ensure(conf: ConnConfig): Promise<ServerHandle | undefined>;
	stop(name: string): Promise<void>;
	stopAll(): Promise<void>;
	status(name: string): ServerState;
	logs(name: string): string;
}

export interface ToolkitRegistry {
	all(): ConnConfig[];
}

export interface SearchDocument {
	id: string;
	name: string;
	keywords?: readonly string[];
	description?: string;
}

export interface SearchHit {
	id: string;
	score: number;
}

export interface SearchEngine {
	search(
		query: string,
		documents: readonly SearchDocument[],
	): readonly SearchHit[];
}

export interface OAuthRecord {
	clientInformation?: OAuthClientInformationFull;
	tokens?: OAuthTokens;
	codeVerifier?: string;
}

export interface OAuthStore {
	load(serverKey: string): Promise<OAuthRecord | undefined>;
	save(serverKey: string, record: OAuthRecord): Promise<void>;
	clear(serverKey: string): Promise<void>;
}

export interface EnvLookup {
	get(name: string): string | undefined;
}
