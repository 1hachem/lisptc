import { oauthEnv } from "@repo/env/oauth";
import { systemClock } from "@repo/shared/host";
import { filePrompt } from "@repo/shared/host-node";
import { LocalProcessHost } from "./local-host.ts";
import { cachedMachine } from "./machine.ts";
import type { McpExtensionHost } from "./mcp.ts";
import { mcpClient } from "./mcp-client.ts";
import { completeAuthorization } from "./mcp-oauth.ts";
import { MemoryOAuthStore } from "./oauth-host.ts";
import type { McpClient, McpHost, OAuthStore } from "./ports.ts";
import { miniSearchEngine } from "./search.ts";
import {
	bridgedEntries,
	bundledToolkit,
	desktopToolkit,
	localToolkit,
} from "./toolkit.ts";

export interface McpHostOptions {
	scope?: string;
	oauth: OAuthStore;
	host?: McpHost;
	desktop?: () => Promise<boolean>;
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

function desktopParts(
	presence: () => Promise<boolean>,
): Pick<McpExtensionHost, "toolkit" | "machine"> {
	const bundled = bundledToolkit();
	const bridged = bridgedEntries(bundled, localToolkit());
	const machine = cachedMachine(presence, () =>
		bridged.map((conf) => conf.name),
	);
	return {
		toolkit: desktopToolkit(bundled, bridged, () => machine.connected()),
		machine,
	};
}

export function mcpHostFor(options: McpHostOptions): McpExtensionHost {
	return {
		client: localMcpClient(options),
		...(options.desktop === undefined
			? { toolkit: bundledToolkit() }
			: desktopParts(options.desktop)),
		search: miniSearchEngine,
		prompt: mcpPrompt,
		clock: systemClock,
	};
}

export const mcpHost: McpExtensionHost = mcpHostFor({
	oauth: new MemoryOAuthStore(),
});
