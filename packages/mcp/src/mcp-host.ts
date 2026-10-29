import { homedir } from "node:os";
import { join } from "node:path";
import { mcpEnv } from "@repo/env/mcp";
import { oauthEnv } from "@repo/env/oauth";
import { systemClock } from "@repo/shared/host";
import { filePrompt } from "@repo/shared/host-node";
import { DockerHost, dockerAnswers } from "./docker-host.ts";
import { clusterServes, KubernetesHost } from "./kubernetes-host.ts";
import { LocalProcessHost } from "./local-host.ts";
import { cachedMachine } from "./machine.ts";
import type { McpExtensionHost } from "./mcp.ts";
import { mcpClient } from "./mcp-client.ts";
import { completeAuthorization } from "./mcp-oauth.ts";
import { MemoryOAuthStore } from "./oauth-host.ts";
import type {
	McpClient,
	McpHost,
	OAuthClients,
	OAuthStore,
	ServerReporter,
} from "./ports.ts";
import { type HostCandidate, ProbedHost } from "./probed-host.ts";
import { miniSearchEngine } from "./search.ts";
import {
	bridgedEntries,
	bundledToolkit,
	desktopToolkit,
	localToolkit,
	machineToolkit,
} from "./toolkit.ts";

export interface McpHostOptions {
	scope?: string;
	oauth: OAuthStore;
	host?: McpHost;
	desktop?: () => Promise<boolean>;
}

function oauthClients(): OAuthClients {
	const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET } = oauthEnv;
	return GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET
		? {
				google: {
					client_id: GOOGLE_CLIENT_ID,
					client_secret: GOOGLE_CLIENT_SECRET,
				},
			}
		: {};
}

export function localMcpClient(options: McpHostOptions): McpClient {
	return mcpClient({
		host: options.host ?? new LocalProcessHost(),
		oauth: options.oauth,
		redirectUri: oauthEnv.LISPTC_OAUTH_REDIRECT_URL,
		callbackPort: oauthEnv.LISPTC_OAUTH_CALLBACK_PORT,
		clients: oauthClients(),
		scope: options.scope,
		stateHome: join(
			mcpEnv.XDG_DATA_HOME ?? join(homedir(), ".local", "share"),
			"lisptc",
			"mcp",
		),
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
		oauthClients(),
	);
}

export function containerHost(
	scope: string,
	report?: ServerReporter,
	chat?: string,
): McpHost {
	const inCluster =
		mcpEnv.LISPTC_MCP_HOST === "kubernetes" ||
		mcpEnv.KUBERNETES_SERVICE_HOST !== undefined;
	const kubernetes: HostCandidate = {
		name: "the cluster",
		available: async () =>
			inCluster && (await clusterServes(mcpEnv.LISPTC_MCP_NAMESPACE)),
		create: () =>
			new KubernetesHost({
				scope,
				...(chat === undefined ? {} : { chat }),
				namespace: mcpEnv.LISPTC_MCP_NAMESPACE ?? "",
				imageTag: mcpEnv.LISPTC_MCP_IMAGE_TAG,
			}),
		required: inCluster,
	};
	const docker: HostCandidate = {
		name: "docker",
		available: dockerAnswers,
		create: () => new DockerHost(new LocalProcessHost(), scope, report),
	};
	const tried = {
		kubernetes: [kubernetes, docker],
		docker: [docker],
	};
	if (mcpEnv.LISPTC_MCP_HOST === "process") return new LocalProcessHost();
	return new ProbedHost(
		tried[mcpEnv.LISPTC_MCP_HOST ?? "kubernetes"],
		() => new LocalProcessHost(),
	);
}

export const mcpPrompt = filePrompt(new URL("./mcp.ptc", import.meta.url));

function desktopParts(
	presence: () => Promise<boolean>,
): Pick<McpExtensionHost, "toolkit" | "machine"> {
	const bundled = bundledToolkit();
	const bridged = bridgedEntries(bundled, machineToolkit());
	const machine = cachedMachine(presence, () =>
		[...bridged.own, ...bridged.variants].map((conf) => conf.name),
	);
	return {
		toolkit: desktopToolkit(bundled, bridged, () => machine.connected()),
		machine,
	};
}

export function mcpHostFor(options: McpHostOptions): McpExtensionHost {
	const host = options.host ?? new LocalProcessHost();
	return {
		client: localMcpClient({ ...options, host }),
		...(options.desktop !== undefined
			? desktopParts(options.desktop)
			: {
					toolkit:
						host instanceof LocalProcessHost
							? localToolkit()
							: bundledToolkit(),
				}),
		search: miniSearchEngine,
		prompt: mcpPrompt,
		clock: systemClock,
	};
}

export const mcpHost: McpExtensionHost = mcpHostFor({
	oauth: new MemoryOAuthStore(),
});
