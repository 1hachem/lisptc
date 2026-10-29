export type ServerRowPhase = "starting" | "ready" | "sleeping" | "failed";
export type StateRowPhase = "bound" | "pending" | "resizing" | "released";

export interface RowOwner {
	workspace: string;
	server: string;
	instance?: string;
}

export interface ServerRow extends RowOwner {
	phase: ServerRowPhase | "gone";
	reason?: string;
}

export interface StateRow extends RowOwner {
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
