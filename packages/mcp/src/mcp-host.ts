import { oauthEnv } from "@repo/env/oauth";
import { filePrompt } from "@repo/shared/host-node";
import { LocalProcessHost } from "./local-host.ts";
import type { McpExtensionHost } from "./mcp.ts";
import { mcpClient } from "./mcp-client.ts";
import { FileOAuthStore } from "./mcp-oauth.ts";
import type { McpClient, McpHost, OAuthStore } from "./ports.ts";
import { bundledToolkit } from "./toolkit.ts";

function callbackPort(): number {
	return oauthEnv.LISPTC_OAUTH_CALLBACK_PORT ?? 8909;
}

function redirectUri(): string {
	return (
		oauthEnv.LISPTC_OAUTH_REDIRECT_URL ??
		`http://127.0.0.1:${callbackPort()}/callback`
	);
}

export interface McpHostOptions {
	scope?: string;
	oauth?: OAuthStore;
	host?: McpHost;
}

export function localMcpClient(options: McpHostOptions = {}): McpClient {
	return mcpClient({
		host: options.host ?? new LocalProcessHost(),
		oauth: options.oauth ?? new FileOAuthStore(),
		redirectUri: redirectUri(),
		callbackPort: callbackPort(),
		scope: options.scope,
	});
}

export const mcpPrompt = filePrompt(new URL("./mcp.ptc", import.meta.url));

export function mcpHostFor(options: McpHostOptions = {}): McpExtensionHost {
	return {
		client: localMcpClient(options),
		toolkit: bundledToolkit(),
		prompt: mcpPrompt,
	};
}

export const mcpHost: McpExtensionHost = mcpHostFor();
