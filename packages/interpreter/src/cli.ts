/**
 * Interactive command-line REPL for the Lisptc interpreter (the `pnpm repl`
 * entry point). Reads expressions from stdin, evaluates them, prints results to
 * stdout. Everything here is process I/O plumbing on top of the pure language
 * in `./lisp.ts`; the embeddable string-in/string-out REPLs live in `./repl.ts`.
 */

import {
	EndOfFile,
	EvalException,
	Interp,
	prelude,
	Reader,
	run,
	setExit,
	setWriter,
	str,
} from "./lisp.ts";
import { type Repl, seedSecretsFromEnvFile } from "./repl.ts";
import { connectOrSpawn, socketPathFor } from "./session-server.ts";

// Read a line as a string (displaying the given prompt), or null on EOF.
// Wired to a readline interface by main().
let readLine: (prompt: string) => Promise<string | null>;

// Output sink shared with the interpreter (via setWriter) so prin1/princ and
// the loop's own writes land on the same stdout.
const write = (s: string): void => {
	process.stdout.write(s);
};

// The interactive Read-Eval-Print Loop over stdin/stdout.
class InteractiveRepl implements Repl {
	private currentInterp: Interp;
	private readonly stdInTokens: Reader = new Reader();

	constructor() {
		this.currentInterp = this.freshInterp();
	}

	get interp(): Interp {
		return this.currentInterp;
	}

	private freshInterp(): Interp {
		const interp = new Interp();
		run(interp, prelude);
		seedSecretsFromEnvFile(interp);
		return interp;
	}

	reset(): void {
		this.currentInterp = this.freshInterp();
	}

	// Read an expression from the standard-in asynchronously.
	private async readExpression(
		prompt1: string,
		prompt2: string,
	): Promise<unknown> {
		const oldTokens = new Reader();
		for (;;) {
			oldTokens.copyFrom(this.stdInTokens);
			try {
				return this.stdInTokens.read();
			} catch (ex) {
				if (ex === EndOfFile) {
					const line = await readLine(oldTokens.isEmpty() ? prompt1 : prompt2);
					if (line === null) return EndOfFile;
					oldTokens.push(line);
					this.stdInTokens.copyFrom(oldTokens);
				} else {
					this.stdInTokens.clear(); // Discard the erroneous tokens.
					throw ex;
				}
			}
		}
	}

	// Repeat Read-Eval-Print until End-Of-File asynchronously.
	async readEvalPrintLoop(): Promise<void> {
		for (;;) {
			try {
				const exp = await this.readExpression("> ", "  ");
				if (exp === EndOfFile) {
					write("Goodbye\n");
					return;
				}
				const result = this.currentInterp.eval(exp, null);
				write(`${str(result)}\n`);
			} catch (ex) {
				if (ex instanceof EvalException) write(`${ex}\n`);
				else throw ex;
			}
		}
	}
}

// Does `text` contain only complete top-level forms (nothing left mid-parse)?
// Used by the attach loop to decide when to ship input to the shared session,
// so multi-line forms typed (or sent by Iron) aren't split across evals.
function isComplete(text: string): boolean {
	const reader = new Reader();
	reader.push(text);
	try {
		for (;;) reader.read();
	} catch (ex) {
		// Incomplete form: more input needed. A genuine parse error is "complete"
		// enough to send — the session renders it inline.
		if (ex === EndOfFile) return reader.isEmpty();
		return true;
	}
}

// Attach loop (`--attach`): forward each complete form to the SHARED session
// REPL rather than evaluating locally, so this terminal and the editor's LSP
// operate on one interpreter. `connectOrSpawn` boots a session for the project
// if none is running.
async function attachLoop(): Promise<void> {
	const client = await connectOrSpawn(socketPathFor());
	let accum = "";
	for (;;) {
		const line = await readLine(accum === "" ? "> " : "  ");
		if (line === null) {
			write("Goodbye\n");
			client.close();
			return;
		}
		accum += `${line}\n`;
		if (accum.trim() === "") {
			accum = "";
			continue;
		}
		if (!isComplete(accum)) continue;
		write(await client.eval(accum));
		accum = "";
	}
}

//----------------------------------------------------------------------
// Main procedure for Node.js: a dedicated standalone REPL.
// Run the REPL on the first '-' argument (or with no arguments);
// run each script file for other arguments.
//
// Guarded so that importing this module does NOT start the REPL / attach to
// stdin; it only runs when this file is the process entry point.

async function main(): Promise<void> {
	const { pathToFileURL } = await import("node:url");
	const entry = process.argv[1];
	if (!entry || import.meta.url !== pathToFileURL(entry).href) return;

	// Clear screen + scrollback and home the cursor.
	const CLEAR_SCREEN = "\x1b[2J\x1b[3J\x1b[H";

	const isTTY = process.stdin.isTTY === true;
	let rl: import("node:readline").Interface | null = null;
	let closed = false;
	let lastInput = ""; // for the :up recall command in non-TTY (piped) mode
	const pending: string[] = []; // lines received while no reader was waiting
	let waiter: ((line: string | null) => void) | null = null;

	readLine = async (prompt) => {
		if (rl === null) {
			const { createInterface } = await import("node:readline");
			rl = createInterface({
				input: process.stdin,
				output: process.stdout,
				terminal: isTTY, // enables arrow-key line editing & history on a TTY
				historySize: 500,
			});
			rl.on("line", (l) => {
				if (waiter) {
					const w = waiter;
					waiter = null;
					w(l);
				} else {
					pending.push(l);
				}
			});
			rl.on("close", () => {
				closed = true;
				if (waiter) {
					const w = waiter;
					waiter = null;
					w(null);
				}
			});
			// Ctrl-C cancels the current input line instead of exiting.
			rl.on("SIGINT", () => {
				write("\n");
				if (waiter) {
					const w = waiter;
					waiter = null;
					w("");
				}
			});
		}
		const line = await new Promise<string | null>((resolve) => {
			if (pending.length > 0) {
				write(prompt);
				resolve(pending.shift() as string);
				return;
			}
			if (closed) {
				resolve(null);
				return;
			}
			waiter = resolve;
			if (isTTY) {
				rl?.setPrompt(prompt);
				rl?.prompt();
			} else {
				write(prompt);
			}
		});
		if (line === null) return null;
		// :clear (or "clear") wipes the screen and re-prompts. Works when piped,
		// too, and complements the Ctrl-L keystroke on a TTY.
		if (line.trim() === ":clear" || line.trim() === "clear") {
			write(CLEAR_SCREEN);
			return "";
		}
		// :up (or a raw up-arrow escape sequence, when there is no TTY to
		// interpret it) recalls the previous input line.
		if (line.trim() === ":up" || line.trim() === "\x1b[A") {
			if (!isTTY && lastInput !== "") write(`${lastInput}\n`);
			return lastInput;
		}
		if (line.trim() !== "") lastInput = line;
		return line;
	};

	setWriter(write);
	setExit(process.exit);

	// `--attach`: forward to the shared session instead of a local interpreter.
	if (process.argv.includes("--attach")) {
		await attachLoop();
		return;
	}

	const repl = new InteractiveRepl();
	let started = false;
	let fs: typeof import("node:fs") | undefined;
	let argv = process.argv as string[];
	if (argv.length <= 2) argv = ["", "", "-"];
	try {
		for (let i = 2; i < argv.length; i++) {
			const fileName = argv[i];
			if (fileName === "-") {
				if (!started) {
					started = true;
					await repl.readEvalPrintLoop();
				}
			} else {
				fs = fs || (await import("node:fs")).default;
				const path = await import("node:path");
				const abs = path.resolve(fileName);
				const text = fs.readFileSync(abs, "utf8");
				// Let relative `import` paths in the script resolve against its dir.
				repl.interp.importStack.push(path.dirname(abs));
				try {
					run(repl.interp, text);
				} finally {
					repl.interp.importStack.pop();
				}
			}
		}
	} catch (ex) {
		console.log(ex);
		process.exit(1);
	}
}

main();
