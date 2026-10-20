import type {
	AgentDefinition,
	AgentDefinitions,
} from "@repo/agents-extension/ports";
import type { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api.js";
import type { Id } from "../convex/_generated/dataModel.js";

export type AgentClient = Pick<ConvexHttpClient, "query" | "mutation">;

function definitionOf(row: AgentDefinition): AgentDefinition {
	return { name: row.name, prompt: row.prompt };
}

export class ConvexAgentStore implements AgentDefinitions {
	constructor(
		private readonly workspaceId: Id<"workspaces">,
		private readonly connect: () => AgentClient,
	) {}

	async all(): Promise<AgentDefinition[]> {
		const rows = await this.connect().query(api.agents.list, {
			workspaceId: this.workspaceId,
		});
		return rows.map(definitionOf);
	}

	async get(name: string): Promise<AgentDefinition | undefined> {
		return (await this.all()).find((agent) => agent.name === name);
	}

	async put(definition: AgentDefinition): Promise<void> {
		await this.connect().mutation(api.agents.put, {
			workspaceId: this.workspaceId,
			agent: definitionOf(definition),
		});
	}

	async delete(name: string): Promise<boolean> {
		return await this.connect().mutation(api.agents.remove, {
			workspaceId: this.workspaceId,
			name,
		});
	}
}
