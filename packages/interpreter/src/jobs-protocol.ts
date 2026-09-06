export const STATE_PENDING = 0;
export const STATE_DONE = 1;
export const STATE_ERROR = 2;
export const STATE_SPILL = 3;

export const CTRL_BYTES = 8;
export const DATA_BYTES = 1 << 20;

export const DEFAULT_TIMEOUT_MS = 30_000;
export const AWAIT_TIMEOUT_MS = 50_000;

export interface WorkerRequest {
	id: string;
	op: string;
	payload: unknown;
	ctrl: SharedArrayBuffer;
	data: SharedArrayBuffer;
}

export type SettledReply = {
	jobId: string;
	ok: boolean;
	v?: unknown;
	e?: string;
};

export type JobSettledMessage = {
	type?: string;
	jobId?: string;
	ok?: boolean;
	v?: unknown;
};
