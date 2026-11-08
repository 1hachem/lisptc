import type { ClaimStatus, McpServer } from "@repo/mcp-extension/kubernetes";
import type { Cluster, Located, Servers } from "./cluster.ts";
import { type Placement, reconcile } from "./reconcile.ts";
import type {
	ServerRow,
	Snapshot,
	StateRow,
	StatusSink,
} from "./status-sink.ts";
import { sweep } from "./sweep.ts";
import {
	claimOwner,
	namespaceFor,
	ownerOf,
	RELEASED_AT,
	STATE_LABEL,
	STATE_PATH,
} from "./workload.ts";

const BACKOFF_MIN_MS = 1_000;
const BACKOFF_MAX_MS = 60_000;

export interface ControllerDeps {
	cluster: Cluster;
	servers: Servers;
	sink: StatusSink;
	placement: Placement;
	lookup(name: string): McpServer | undefined;
	all(): McpServer[];
	clock?: () => number;
	log?: (message: string) => void;
}

function epochSeconds(): number {
	return Math.floor(Date.now() / 1000);
}

function stateRow(
	server: McpServer,
	name: string,
	claim: ClaimStatus,
): StateRow {
	const path =
		[...server.spec.mcp.state, ...(server.spec.app?.state ?? [])].find(
			(entry) => entry.name === name,
		)?.path ?? "";
	return {
		...ownerOf(server),
		name,
		path,
		size: claim.size,
		phase: claim.phase.toLowerCase() as StateRow["phase"],
		...(claim.lastAttached ? { lastAttached: claim.lastAttached } : {}),
	};
}

function stateKey(row: StateRow): string {
	return `${row.workspace}\0${row.server}\0${row.instance ?? ""}\0${row.name}`;
}

function serverRow(server: McpServer): ServerRow[] {
	const phase = server.status?.phase;
	if (!phase) return [];
	return [
		{
			...ownerOf(server),
			phase: phase.toLowerCase() as ServerRow["phase"],
			...(server.status?.reason ? { reason: server.status.reason } : {}),
		},
	];
}

function releasedRow(claim: Located): StateRow | undefined {
	const released = Number(claim.annotations[RELEASED_AT]);
	if (!released) return undefined;
	return {
		...claimOwner(claim.annotations),
		name: claim.labels[STATE_LABEL] ?? "",
		path: claim.annotations[STATE_PATH] ?? "",
		size: "",
		phase: "released",
		releasedAt: released,
	};
}

export class Controller {
	private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
	private readonly running = new Set<string>();
	private readonly again = new Set<string>();
	private readonly failures = new Map<string, number>();
	private readonly clock: () => number;
	private readonly log: (message: string) => void;

	constructor(private readonly deps: ControllerDeps) {
		this.clock = deps.clock ?? epochSeconds;
		this.log = deps.log ?? ((message) => console.error(message));
	}

	enqueue(name: string, delayMs = 0): void {
		const pending = this.timers.get(name);
		if (pending) clearTimeout(pending);
		const timer = setTimeout(() => {
			this.timers.delete(name);
			void this.process(name);
		}, delayMs);
		timer.unref?.();
		this.timers.set(name, timer);
	}

	stop(): void {
		for (const timer of this.timers.values()) clearTimeout(timer);
		this.timers.clear();
	}

	async process(name: string): Promise<void> {
		if (this.running.has(name)) {
			this.again.add(name);
			return;
		}
		this.running.add(name);
		try {
			const server = this.deps.lookup(name);
			if (!server) return;
			const now = this.clock();
			const outcome = await reconcile(server, { ...this.deps, now });
			this.failures.delete(name);
			if (outcome.requeueAt !== undefined)
				this.enqueue(name, Math.max(0, outcome.requeueAt - now) * 1000);
		} catch (ex) {
			const tries = (this.failures.get(name) ?? 0) + 1;
			this.failures.set(name, tries);
			const delay = Math.min(BACKOFF_MAX_MS, BACKOFF_MIN_MS * 2 ** (tries - 1));
			this.log(
				`${name}: reconcile failed (try ${tries}), again in ${delay}ms: ${ex instanceof Error ? ex.message : String(ex)}`,
			);
			this.enqueue(name, delay);
		} finally {
			this.running.delete(name);
			if (this.again.delete(name)) this.enqueue(name);
		}
	}

	async snapshot(): Promise<Snapshot> {
		const servers = this.deps.all();
		const state = servers.flatMap((server) =>
			Object.entries(server.status?.state ?? {}).map(([name, claim]) =>
				stateRow(server, name, claim),
			),
		);
		const seen = new Set(state.map(stateKey));
		const released = (await this.deps.cluster.managedClaims())
			.filter((claim) => claim.namespace.startsWith(this.deps.placement.prefix))
			.map(releasedRow)
			.filter(
				(row): row is StateRow => row !== undefined && !seen.has(stateKey(row)),
			);
		return {
			servers: servers.flatMap(serverRow),
			state: [...state, ...released],
		};
	}

	async resync(): Promise<void> {
		for (const server of this.deps.all()) this.enqueue(server.metadata.name);
		await this.mirror();
	}

	async mirror(): Promise<void> {
		await this.deps.sink.reconcile(await this.snapshot());
	}

	async sweep(): Promise<void> {
		const servers = this.deps.all();
		const { prefix } = this.deps.placement;
		await sweep({
			cluster: this.deps.cluster,
			sink: this.deps.sink,
			prefix,
			live: new Set(servers.map((server) => server.metadata.name)),
			liveNamespaces: new Set(
				servers.map((server) => namespaceFor(prefix, server.spec.workspace)),
			),
			now: this.clock(),
		});
	}
}
