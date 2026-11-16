import type { SourceFolder } from "@repo/shared/host";
import { AGENT_FOLDER, agentFileName, agentNameOf } from "./definition.ts";

export class AgentLibrary {
	constructor(
		private readonly folder: SourceFolder,
		private readonly workspace: string,
	) {}

	async names(): Promise<string[]> {
		const files = await this.folder.list(this.workspace, AGENT_FOLDER);
		return files.flatMap((file) => {
			const name = agentNameOf(file);
			return name === undefined ? [] : [name];
		});
	}

	async source(name: string): Promise<string | undefined> {
		return await this.folder.read(
			this.workspace,
			AGENT_FOLDER,
			agentFileName(name),
		);
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
