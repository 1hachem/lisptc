import { mcpEnv } from "@repo/env/mcp";
import { oauthEnv } from "@repo/env/oauth";
import { systemClock } from "@repo/shared/host";
import { filePrompt } from "@repo/shared/host-node";
import { DockerHost, dockerAnswers } from "./docker-host.ts";
import { clusterServes, KubernetesHost } from "./kubernetes-host.ts";
import { launchFor } from "./launch.ts";
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
import { RemoteHost, remoteServer } from "./remote-host.ts";
import { RoutedHost } from "./routed-host.ts";
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
		host: options.host ?? localHost(),
		oauth: options.oauth,
		redirectUri: oauthEnv.LISPTC_OAUTH_REDIRECT_URL,
		callbackPort: oauthEnv.LISPTC_OAUTH_CALLBACK_PORT,
		clients: oauthClients(),
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
		oauthClients(),
	);
}

const everything = () => true;

export function localHost(report?: ServerReporter): McpHost {
	return new RoutedHost([
		{ claims: remoteServer, host: new RemoteHost(report) },
		{ claims: everything, host: new LocalProcessHost(report) },
	]);
}

export function dockerHost(report?: ServerReporter): McpHost {
	return new RoutedHost([
		{ claims: remoteServer, host: new RemoteHost(report) },
		{
			claims: (conf) => launchFor(conf) !== undefined,
			host: new DockerHost(report),
		},
		{ claims: everything, host: new LocalProcessHost(report) },
	]);
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
		create: () => dockerHost(report),
	};
	const tried = {
		kubernetes: [kubernetes],
		docker: [docker],
	};
	if (mcpEnv.LISPTC_MCP_HOST === "process") return localHost(report);
	return new ProbedHost(tried[mcpEnv.LISPTC_MCP_HOST ?? "kubernetes"], () =>
		localHost(report),
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
	return {
		client: localMcpClient(options),
		...(options.desktop !== undefined
			? desktopParts(options.desktop)
			: {
					toolkit:
						options.host === undefined ? localToolkit() : bundledToolkit(),
				}),
		search: miniSearchEngine,
		prompt: mcpPrompt,
		clock: systemClock,
	};
}

export const mcpHost: McpExtensionHost = mcpHostFor({
	oauth: new MemoryOAuthStore(),
});
