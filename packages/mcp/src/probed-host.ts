import type {
	ConnConfig,
	McpHost,
	ServerHandle,
	ServerState,
} from "./ports.ts";

export interface HostCandidate {
	name: string;
	available(): Promise<boolean>;
	create(): McpHost;
	required?: boolean;
}

async function refusal(candidate: HostCandidate): Promise<unknown> {
	try {
		return (await candidate.available()) ? undefined : "it did not answer.";
	} catch (cause) {
		return cause ?? "its probe failed.";
	}
}

function reasonOf(cause: unknown): string {
	return cause instanceof Error ? cause.message : String(cause);
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
		await (await this.settled())?.stop(name);
	}

	async stopAll(): Promise<void> {
		await (await this.settled())?.stopAll();
	}

	status(name: string): ServerState {
		return this.host?.status(name) ?? "unknown";
	}

	logs(name: string): string {
		return this.host?.logs(name) ?? "";
	}

	used(name: string): void {
		this.host?.used(name);
	}

	async asleep(name: string): Promise<boolean> {
		return (await this.host?.asleep(name)) ?? false;
	}

	private settled(): Promise<McpHost | undefined> {
		return this.chosen?.catch(() => undefined) ?? Promise.resolve(undefined);
	}

	private resolve(): Promise<McpHost> {
		this.chosen ??= this.pick().then(
			(host) => {
				this.host = host;
				return host;
			},
			(error: unknown) => {
				this.chosen = undefined;
				throw error;
			},
		);
		return this.chosen;
	}

	private async pick(): Promise<McpHost> {
		for (const candidate of this.candidates) {
			const cause = await refusal(candidate);
			if (cause === undefined) return candidate.create();
			if (candidate.required)
				throw new Error(
					`MCP servers have to run on ${candidate.name} here, but ${reasonOf(cause)}`,
					{ cause },
				);
		}
		return this.last();
	}
}
