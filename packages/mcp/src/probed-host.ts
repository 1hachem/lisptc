import type {
	ConnConfig,
	McpHost,
	ServerHandle,
	ServerState,
} from "./ports.ts";

export interface HostCandidate {
	available(): Promise<boolean>;
	create(): McpHost;
}

async function answers(candidate: HostCandidate): Promise<boolean> {
	try {
		return await candidate.available();
	} catch {
		return false;
	}
}

export class ProbedHost implements McpHost {
	private chosen: Promise<McpHost> | undefined;
	private host: McpHost | undefined;

	constructor(
		private readonly candidates: HostCandidate[],
		private readonly last: () => McpHost,
	) {}

	async ensure(conf: ConnConfig): Promise<ServerHandle | undefined> {
		return await (await this.resolve()).ensure(conf);
	}

	async stop(name: string): Promise<void> {
		await (await this.chosen)?.stop(name);
	}

	async stopAll(): Promise<void> {
		await (await this.chosen)?.stopAll();
	}

	status(name: string): ServerState {
		return this.host?.status(name) ?? "unknown";
	}

	logs(name: string): string {
		return this.host?.logs(name) ?? "";
	}

	private resolve(): Promise<McpHost> {
		this.chosen ??= this.pick().then((host) => {
			this.host = host;
			return host;
		});
		return this.chosen;
	}

	private async pick(): Promise<McpHost> {
		for (const candidate of this.candidates)
			if (await answers(candidate)) return candidate.create();
		return this.last();
	}
}
