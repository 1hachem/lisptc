import { mcpEnv } from "@repo/env/mcp";
import { oauthEnv } from "@repo/env/oauth";
import { filePrompt } from "@repo/shared/host-node";
import { DockerHost, dockerAnswers } from "./docker-host.ts";
import { clusterAnswers, KubernetesHost } from "./kubernetes-host.ts";
import { LocalProcessHost } from "./local-host.ts";
import type { McpExtensionHost } from "./mcp.ts";
import { mcpClient } from "./mcp-client.ts";
import { completeAuthorization, FileOAuthStore } from "./mcp-oauth.ts";
import type { McpClient, McpHost, OAuthStore } from "./ports.ts";
import { type HostCandidate, ProbedHost } from "./probed-host.ts";
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

export function containerHost(scope: string): McpHost {
	const kubernetes: HostCandidate = {
		available: async () =>
			(mcpEnv.LISPTC_MCP_HOST === "kubernetes" ||
				mcpEnv.KUBERNETES_SERVICE_HOST !== undefined) &&
			(await clusterAnswers()),
		create: () =>
			new KubernetesHost({
				scope,
				namespacePrefix: mcpEnv.LISPTC_MCP_NAMESPACE_PREFIX,
				callerNamespace: mcpEnv.LISPTC_MCP_CALLER_NAMESPACE,
				pullSecret: mcpEnv.LISPTC_MCP_PULL_SECRET,
			}),
	};
	const docker: HostCandidate = {
		available: dockerAnswers,
		create: () => new DockerHost(),
	};
	const tried = {
		kubernetes: [kubernetes, docker],
		docker: [docker],
		process: [],
	};
	return new ProbedHost(
		tried[mcpEnv.LISPTC_MCP_HOST ?? "kubernetes"],
		() => new LocalProcessHost(),
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
