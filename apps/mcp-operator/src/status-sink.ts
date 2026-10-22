export type ServerRowPhase = "starting" | "ready" | "sleeping" | "failed";
export type StateRowPhase = "bound" | "pending" | "resizing" | "released";

export interface ServerRow {
	workspace: string;
	server: string;
	phase: ServerRowPhase | "gone";
	reason?: string;
}

export interface StateRow {
	workspace: string;
	server: string;
	name: string;
	path: string;
	size: string;
	phase: StateRowPhase | "gone";
	lastAttached?: number;
	releasedAt?: number;
}

export interface Snapshot {
	servers: ServerRow[];
	state: StateRow[];
}

export interface StatusSink {
	observeServer(row: ServerRow): Promise<void>;
	observeState(row: StateRow): Promise<void>;
	reconcile(snapshot: Snapshot): Promise<void>;
}
