import { oauthEnv } from "@repo/env/oauth";
import { filePrompt } from "@repo/shared/host-node";
import { LocalProcessHost } from "./local-host.ts";
import type { McpExtensionHost } from "./mcp.ts";
import { mcpClient } from "./mcp-client.ts";
import { FileOAuthStore } from "./mcp-oauth.ts";
import type { McpClient } from "./ports.ts";
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

export function localMcpClient(scope?: string): McpClient {
	return mcpClient({
		host: new LocalProcessHost(),
		oauth: new FileOAuthStore(),
		redirectUri: redirectUri(),
		callbackPort: callbackPort(),
		scope,
	});
}

const mcpPrompt = filePrompt(new URL("./mcp.ptc", import.meta.url));

export function mcpHostFor(scope?: string): McpExtensionHost {
	return {
		client: localMcpClient(scope),
		toolkit: bundledToolkit(),
		prompt: mcpPrompt,
	};
}

export const mcpHost: McpExtensionHost = mcpHostFor();
