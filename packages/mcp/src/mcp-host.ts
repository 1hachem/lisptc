import { oauthEnv } from "@repo/env/oauth";
import { systemClock } from "@repo/shared/host";
import { filePrompt } from "@repo/shared/host-node";
import { LocalProcessHost } from "./local-host.ts";
import type { McpExtensionHost } from "./mcp.ts";
import { mcpClient } from "./mcp-client.ts";
import { completeAuthorization } from "./mcp-oauth.ts";
import { MemoryOAuthStore } from "./oauth-host.ts";
import type { McpClient, McpHost, OAuthStore } from "./ports.ts";
import { miniSearchEngine } from "./search.ts";
import { bundledToolkit, desktopToolkit, localToolkit } from "./toolkit.ts";

export interface McpHostOptions {
	scope?: string;
	oauth: OAuthStore;
	host?: McpHost;
	desktop?: boolean;
}

export function localMcpClient(options: McpHostOptions): McpClient {
	return mcpClient({
		host: options.host ?? new LocalProcessHost(),
		oauth: options.oauth,
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

export function mcpHostFor(options: McpHostOptions): McpExtensionHost {
	return {
		client: localMcpClient(options),
		toolkit: options.desktop
			? desktopToolkit(bundledToolkit(), localToolkit())
			: bundledToolkit(),
		search: miniSearchEngine,
		prompt: mcpPrompt,
		clock: systemClock,
	};
}

export const mcpHost: McpExtensionHost = mcpHostFor({
	oauth: new MemoryOAuthStore(),
});
