import type { McpServer } from "@repo/mcp-extension/kubernetes";
import type { Cluster, Servers } from "./cluster.ts";
import { type Placement, reconcile } from "./reconcile.ts";
import type {
	Existing,
	ServerRow,
	Snapshot,
	StatusSink,
} from "./status-sink.ts";
import { sweep } from "./sweep.ts";
import { ownerOf } from "./workload.ts";

const BACKOFF_MIN_MS = 1_000;
const BACKOFF_MAX_MS = 60_000;

export interface ControllerDeps {
	cluster: Cluster;
	servers: Servers;
	sink: StatusSink;
	workspaces: Existing;
	chats: Existing;
	placement: Placement;
	lookup(name: string): McpServer | undefined;
	all(): McpServer[];
	clock?: () => number;
	log?: (message: string) => void;
}

function epochSeconds(): number {
	return Math.floor(Date.now() / 1000);
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

	snapshot(): Snapshot {
		return { servers: this.deps.all().flatMap(serverRow) };
	}

	async resync(): Promise<void> {
		for (const server of this.deps.all()) this.enqueue(server.metadata.name);
		await this.mirror();
	}

	async mirror(): Promise<void> {
		await this.deps.sink.reconcile(this.snapshot());
	}

	async sweep(): Promise<void> {
		const { cluster, placement, servers, workspaces, chats } = this.deps;
		await sweep({
			cluster,
			prefix: placement.prefix,
			servers: this.deps.all(),
			existing: (ids) => workspaces.existing(ids),
			existingChats: (ids) => chats.existing(ids),
			removeServer: (name) => servers.remove(name),
			now: this.clock(),
		});
	}
}
