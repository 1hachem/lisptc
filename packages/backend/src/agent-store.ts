import type {
	AgentDefinition,
	AgentDefinitions,
} from "@repo/agents-extension/ports";
import { Cell, type List, listToArray } from "@repo/interpreter/objects";
import { parsePlist } from "@repo/interpreter/plist";
import { Reader } from "@repo/interpreter/reader";
import { parseRules } from "@repo/permissions-extension/rules";
import type { SourceFolder } from "@repo/shared/host";
import {
	AGENT_FOLDER,
	agentFileName,
	agentSource,
} from "../convex/lib/agentSource.ts";

const EXTENSION = ".ptc";

export function parseAgentSource(text: string): AgentDefinition | undefined {
	const reader = new Reader();
	reader.push(text);
	const form = reader.read();
	if (!(form instanceof Cell)) return undefined;
	const [, name] = listToArray(form);
	const options = parsePlist((form.cdr as Cell).cdr as List);
	const prompt = options.get("prompt");
	const permissions = options.get("permissions");
	if (typeof name !== "string" || typeof prompt !== "string") return undefined;
	return typeof permissions === "string"
		? { name, prompt, permissions }
		: { name, prompt };
}

export class SourceAgentStore implements AgentDefinitions {
	constructor(
		private readonly folder: SourceFolder,
		private readonly workspace: string,
		private readonly roster?: readonly string[],
	) {}

	private allowed(name: string): boolean {
		return this.roster === undefined || this.roster.includes(name);
	}

	async all(): Promise<AgentDefinition[]> {
		const files = await this.folder.list(this.workspace, AGENT_FOLDER);
		const names = files
			.filter((file) => file.endsWith(EXTENSION))
			.map((file) => file.slice(0, -EXTENSION.length))
			.filter((name) => this.allowed(name));
		const definitions = await Promise.all(names.map((name) => this.get(name)));
		return definitions.filter(
			(definition): definition is AgentDefinition => definition !== undefined,
		);
	}

	async get(name: string): Promise<AgentDefinition | undefined> {
		if (!this.allowed(name)) return undefined;
		const text = await this.folder.read(
			this.workspace,
			AGENT_FOLDER,
			agentFileName(name),
		);
		return text === undefined ? undefined : parseAgentSource(text);
	}

	async put(definition: AgentDefinition): Promise<void> {
		if (definition.permissions !== undefined)
			parseRules(definition.permissions);
		await this.folder.write(
			this.workspace,
			AGENT_FOLDER,
			agentFileName(definition.name),
			agentSource(definition),
		);
	}

	async delete(name: string): Promise<boolean> {
		return await this.folder.remove(
			this.workspace,
			AGENT_FOLDER,
			agentFileName(name),
		);
	}
}
