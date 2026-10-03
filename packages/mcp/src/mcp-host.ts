import { oauthEnv } from "@repo/env/oauth";
import { filePrompt } from "@repo/shared/host-node";
import { LocalProcessHost } from "./local-host.ts";
import type { McpExtensionHost } from "./mcp.ts";
import { mcpClient } from "./mcp-client.ts";
import { completeAuthorization, FileOAuthStore } from "./mcp-oauth.ts";
import type { McpClient, McpHost, OAuthStore } from "./ports.ts";
import { miniSearchEngine } from "./search.ts";
import { bundledToolkit } from "./toolkit.ts";

export interface McpHostOptions {
	scope?: string;
	oauth?: OAuthStore;
	host?: McpHost;
}

export function localMcpClient(options: McpHostOptions = {}): McpClient {
	return mcpClient({
		host: options.host ?? new LocalProcessHost(),
		oauth: options.oauth ?? new FileOAuthStore(),
		redirectUri: oauthEnv.LISPTC_OAUTH_REDIRECT_URL,
		callbackPort: oauthEnv.LISPTC_OAUTH_CALLBACK_PORT,
		scope: options.scope,
	});
}

export function finishAuthorization(
	oauth: OAuthStore,
	serverKey: string,
	callbackUrl: string,
): Promise<void> {
	return completeAuthorization(
		oauth,
		serverKey,
		oauthEnv.LISPTC_OAUTH_REDIRECT_URL,
		callbackUrl,
	);
}

export const mcpPrompt = filePrompt(new URL("./mcp.ptc", import.meta.url));

export function mcpHostFor(options: McpHostOptions = {}): McpExtensionHost {
	return {
		client: localMcpClient(options),
		toolkit: bundledToolkit(),
		search: miniSearchEngine,
		prompt: mcpPrompt,
	};
}

export const mcpHost: McpExtensionHost = mcpHostFor();
