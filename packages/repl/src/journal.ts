/**
 * Journal — the append-only record of the Lisp an agent runs.
 *
 * A REPL front-end appends every evaluated program (a `.ptc` form) to a
 * `Journal` so a session's Lisp becomes a durable, replayable record. (This is
 * host-side persistence, distinct from Lisp-level "memory", which is a language
 * concept living inside the interpreter.)
 *
 * The interface is intentionally tiny and backend-agnostic: the first
 * implementation writes to a local file (`FileJournal`), but the same contract
 * is meant to be satisfied later by object stores (S3), distributed
 * filesystems (JuiceFS), Cloudflare artifacts, etc.
 *
 * `append` is fire-and-forget from the caller's point of view: it must never
 * throw and must not block evaluation. Remote backends should buffer/queue
 * internally and flush asynchronously; `flush` lets a host await durability at
 * shutdown.
 */
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

export interface Journal {
	// Record one evaluated program. Best-effort: implementations swallow their
	// own errors so a persistence failure never breaks the REPL.
	append(code: string): void;
	// Await any buffered writes reaching the backend. Optional; a synchronous
	// file journal can omit it.
	flush?(): Promise<void>;
}

// Append each program to a local `.ptc` file, one blank line between forms.
// The directory is created lazily on first write.
export class FileJournal implements Journal {
	private dirReady = false;

	constructor(private readonly path: string) {}

	append(code: string): void {
		const form = code.trim();
		if (form === "") return;
		try {
			if (!this.dirReady) {
				mkdirSync(dirname(this.path), { recursive: true });
				this.dirReady = true;
			}
			appendFileSync(this.path, `${form}\n\n`);
		} catch {
			// ignore: persistence is best-effort
		}
	}
}

// A no-op journal: persistence disabled. Used when no journal is configured.
export class NullJournal implements Journal {
	append(): void {}
}
