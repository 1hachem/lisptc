import type { SourceFolder } from "@repo/shared/host";
import { filePrompt } from "@repo/shared/host-node";
import type { AgentsHost } from "./agents.ts";
import type { AgentThreads } from "./ports.ts";

export class MemorySourceFolder implements SourceFolder {
	private readonly texts = new Map<string, string>();

	private key(workspace: string, folder: string, name: string): string {
		return JSON.stringify([workspace, folder, name]);
	}

	list(workspace: string, folder: string): string[] {
		const prefix = JSON.stringify([workspace, folder]).slice(0, -1);
		return [...this.texts.keys()]
			.filter((key) => key.startsWith(`${prefix},`))
			.map((key) => (JSON.parse(key) as string[])[2] ?? "")
			.sort();
	}

	read(workspace: string, folder: string, name: string): string | undefined {
		return this.texts.get(this.key(workspace, folder, name));
	}

	write(workspace: string, folder: string, name: string, text: string): void {
		this.texts.set(this.key(workspace, folder, name), text);
	}

	remove(workspace: string, folder: string, name: string): boolean {
		return this.texts.delete(this.key(workspace, folder, name));
	}
}

export interface AgentsHostOptions {
	folder?: SourceFolder;
	workspace?: string;
	roster?: readonly string[];
	threads?: AgentThreads;
}

export function agentsHostFor(options: AgentsHostOptions = {}): AgentsHost {
	return {
		prompt: filePrompt(new URL("./agents.ptc", import.meta.url)),
		folder: options.folder ?? new MemorySourceFolder(),
		workspace: options.workspace ?? "local",
		...(options.roster === undefined ? {} : { roster: options.roster }),
		...(options.threads === undefined ? {} : { threads: options.threads }),
	};
}
