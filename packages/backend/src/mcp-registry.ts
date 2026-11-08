import type {
	HttpConnConfig,
	McpMount,
	McpRegistry,
	Tool,
} from "@repo/mcp-extension/ports";
import type { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api.js";
import type { Id } from "../convex/_generated/dataModel.js";

export type McpRegistryClient = Pick<ConvexHttpClient, "query" | "mutation">;

export class ConvexMcpRegistry implements McpRegistry {
	constructor(
		private readonly workspaceId: Id<"workspaces">,
		private readonly connect: () => McpRegistryClient,
	) {}

	async mounts(): Promise<readonly McpMount[]> {
		const rows = await this.connect().query(api.mcpServers.mounts, {
			workspaceId: this.workspaceId,
		});
		return rows.map(({ server, conf, tools, icon, login }) => ({
			server,
			...(conf === undefined
				? {}
				: { conf: JSON.parse(conf) as HttpConnConfig }),
			tools: JSON.parse(tools) as Tool[],
			...(icon === undefined ? {} : { icon }),
			...(login === undefined ? {} : { login }),
		}));
	}

	async mount({ server, conf, tools, icon, login }: McpMount): Promise<void> {
		await this.connect().mutation(api.mcpServers.mount, {
			workspaceId: this.workspaceId,
			server,
			...(conf === undefined ? {} : { conf: JSON.stringify(conf) }),
			tools: JSON.stringify(tools),
			...(icon === undefined ? {} : { icon }),
			...(login === undefined ? {} : { login }),
		});
	}

	async unmount(server: string): Promise<void> {
		await this.connect().mutation(api.mcpServers.unmount, {
			workspaceId: this.workspaceId,
			server,
		});
	}
}
