/*
 * Interpreter I/O sinks. Module-level mutable bindings so the interpreter
 * can be imported (e.g. by tests) without a running REPL: output defaults
 * to a no-op and the REPL entry point / setWriter() override it.
 */

// Output string s (a new line on \n char).
export let write: (s: string) => void = () => {};

// Terminate the process with exit code n.
export let exit: (n: number) => void = () => {};

// Redirect interpreter output (used by prin1/princ/terpri). Returns the
// previous writer so callers can restore it.
export function setWriter(fn: (s: string) => void): (s: string) => void {
	const prev = write;
	write = fn;
	return prev;
}

// Install the process-exit hook (used by the standalone REPL entry point).
export function setExit(fn: (n: number) => void): void {
	exit = fn;
}
