import type {
	ConnConfig,
	McpHost,
	ServerHandle,
	ServerRef,
	ServerState,
	StartWatch,
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

	async ensure(conf: ConnConfig, watch?: StartWatch): Promise<ServerHandle> {
		return await (await this.resolve()).ensure(conf, watch);
	}

	async stop(server: ServerRef): Promise<void> {
		await (await this.settled())?.stop(server);
	}

	async stopAll(): Promise<void> {
		await (await this.settled())?.stopAll();
	}

	status(server: ServerRef): ServerState {
		return this.host?.status(server) ?? "unknown";
	}

	logs(server: ServerRef): string {
		return this.host?.logs(server) ?? "";
	}

	used(server: ServerRef): void {
		this.host?.used(server);
	}

	async asleep(server: ServerRef): Promise<boolean> {
		return (await this.host?.asleep(server)) ?? false;
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
