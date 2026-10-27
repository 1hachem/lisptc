import type { SourceFolder } from "@repo/shared/host";
import {
	AGENT_FOLDER,
	agentFileName,
	agentNameOf,
	readDefinition,
} from "./definition.ts";
import { onRoster } from "./names.ts";
import type { AgentDefinition } from "./ports.ts";

export class AgentLibrary {
	constructor(
		private readonly folder: SourceFolder,
		private readonly workspace: string,
		private readonly roster: readonly string[] | undefined,
	) {}

	shows(name: string): boolean {
		return onRoster(this.roster, name);
	}

	async names(): Promise<string[]> {
		const files = await this.folder.list(this.workspace, AGENT_FOLDER);
		return files.flatMap((file) => {
			const name = agentNameOf(file);
			return name === undefined || !this.shows(name) ? [] : [name];
		});
	}

	async source(name: string): Promise<string | undefined> {
		return await this.folder.read(
			this.workspace,
			AGENT_FOLDER,
			agentFileName(name),
		);
	}

	async saved(name: string): Promise<AgentDefinition | undefined> {
		if (!this.shows(name)) return undefined;
		const text = await this.source(name);
		return text === undefined ? undefined : readDefinition(text);
	}

	async save(name: string, text: string): Promise<void> {
		await this.folder.write(
			this.workspace,
			AGENT_FOLDER,
			agentFileName(name),
			text,
		);
	}

	async forget(name: string): Promise<boolean> {
		return await this.folder.remove(
			this.workspace,
			AGENT_FOLDER,
			agentFileName(name),
		);
	}
}
