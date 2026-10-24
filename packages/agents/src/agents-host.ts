import { filePrompt } from "@repo/shared/host-node";
import type { AgentsHost } from "./agents.ts";
import type { AgentDefinition, AgentDefinitions, Jobs } from "./ports.ts";

export class MemoryAgentDefinitions implements AgentDefinitions {
	private readonly saved = new Map<string, AgentDefinition>();

	all(): AgentDefinition[] {
		return [...this.saved.values()];
	}

	get(name: string): AgentDefinition | undefined {
		return this.saved.get(name);
	}

	put(definition: AgentDefinition): void {
		this.saved.set(definition.name, definition);
	}

	delete(name: string): boolean {
		return this.saved.delete(name);
	}
}

export interface AgentsHostOptions {
	definitions?: AgentDefinitions;
	jobs?: Jobs;
}

export function agentsHostFor(options: AgentsHostOptions = {}): AgentsHost {
	return {
		prompt: filePrompt(new URL("./agents.ptc", import.meta.url)),
		definitions: options.definitions ?? new MemoryAgentDefinitions(),
		...(options.jobs === undefined ? {} : { jobs: options.jobs }),
	};
}
