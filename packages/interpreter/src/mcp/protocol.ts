/*
 * Shared main-thread <-> broker protocol definitions.
 *
 * Both sides of the synchronous bridge (src/mcp/bridges/worker.ts and
 * src/mcp/broker.ts) import these, so the wire protocol lives in exactly
 * one place.
 *
 * Per request the main thread allocates two SharedArrayBuffers:
 *   ctrl : Int32Array [state, byteLength, spilled]
 *   data : UTF-8 JSON reply bytes (or, when spilled, a temp-file path)
 * The broker writes the reply, stores the state and notifies ctrl[0].
 */

// Reply states written into ctrl[CTRL_STATE].
export const STATE_PENDING = 0;
export const STATE_DONE = 1;
export const STATE_ERROR = 2;

// ctrl Int32Array slot indices.
export const CTRL_STATE = 0;
export const CTRL_LENGTH = 1;
// Non-zero when the reply was too big for `data`: the data bytes then hold
// the path of a temp file containing the JSON. Orthogonal to DONE/ERROR so
// oversized error replies survive the spill.
export const CTRL_SPILLED = 2;

export const CTRL_BYTES = 3 * Int32Array.BYTES_PER_ELEMENT;
export const DATA_BYTES = 1 << 20; // 1 MiB inline reply buffer

// A connection descriptor sent by the main thread. `deploy` optionally names
// the deployment adapter (see src/mcp/adapter.ts); when omitted it is
// inferred: "http" if `url` is present, else "stdio".
export type ConnConfig =
	| {
			name: string;
			deploy?: string;
			url: string;
			headers?: Record<string, string>;
	  }
	| {
			name: string;
			deploy?: string;
			command: string;
			args?: string[];
			env?: Record<string, string>;
	  };

export type Op = "connect" | "call-tool" | "disconnect";

// The message posted to the broker worker for each request.
export interface BrokerRequest {
	id: string;
	op: Op;
	payload: unknown;
	ctrl: SharedArrayBuffer;
	data: SharedArrayBuffer;
}
