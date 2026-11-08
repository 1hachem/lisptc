export type ServerRowPhase = "starting" | "ready" | "sleeping" | "failed";

export interface RowOwner {
	workspace: string;
	server: string;
	instance?: string;
}

export interface ServerRow extends RowOwner {
	phase: ServerRowPhase | "gone";
	reason?: string;
}

export interface Snapshot {
	servers: ServerRow[];
}

export interface StatusSink {
	observeServer(row: ServerRow): Promise<void>;
	reconcile(snapshot: Snapshot): Promise<void>;
}

export interface Workspaces {
	existing(ids: readonly string[]): Promise<ReadonlySet<string>>;
}
