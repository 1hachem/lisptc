/*
 * Main procedure for Node.js: a dedicated standalone REPL.
 * Run the REPL on the first '-' argument (or with no arguments);
 * run each script file for other arguments.
 *
 * Guarded so that importing this module does NOT start the REPL / attach to
 * stdin; it only runs when this file is the process entry point
 * (node src/main.ts, or the `pnpm repl` script).
 */
import { EndOfFile, EvalException } from "./exceptions.ts";
import type { Interp } from "./interp.ts";
import { setExit, setWriter, write } from "./io.ts";
import { str } from "./printer.ts";
import { Reader } from "./reader.ts";
import { createInterp, run } from "./repl.ts";

const HISTORY_SIZE = 500;

// Read a line as a string (displaying the given prompt), or null on EOF.
let readLine: (prompt: string) => Promise<string | null>;

// Read-Eval-Print Loop
class REPL {
	private readonly stdInTokens: Reader = new Reader();

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
	async readEvalPrintLoop(interp: Interp): Promise<void> {
		for (;;) {
			try {
				const exp = await this.readExpression("> ", "  ");
				if (exp === EndOfFile) {
					write("Goodbye\n");
					return;
				}
				const result = interp.eval(exp, null);
				write(`${str(result)}\n`);
			} catch (ex) {
				if (ex instanceof EvalException) write(`${ex}\n`);
				else throw ex;
			}
		}
	}
}

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

	// Hand a value to the reader currently blocked in readLine, if any.
	// Returns true when a waiter consumed the value.
	const resolveWaiter = (value: string | null): boolean => {
		if (!waiter) return false;
		const w = waiter;
		waiter = null;
		w(value);
		return true;
	};

	readLine = async (prompt) => {
		if (rl === null) {
			const { createInterface } = await import("node:readline");
			rl = createInterface({
				input: process.stdin,
				output: process.stdout,
				terminal: isTTY, // enables arrow-key line editing & history on a TTY
				historySize: HISTORY_SIZE,
			});
			rl.on("line", (l) => {
				if (!resolveWaiter(l)) pending.push(l);
			});
			rl.on("close", () => {
				closed = true;
				resolveWaiter(null);
			});
			// Ctrl-C cancels the current input line instead of exiting.
			rl.on("SIGINT", () => {
				write("\n");
				resolveWaiter("");
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

	setWriter((s: string) => process.stdout.write(s));
	setExit(process.exit);

	const interp = createInterp();

	let repl: REPL | undefined;
	let fs: typeof import("node:fs") | undefined;
	let argv = process.argv as string[];
	if (argv.length <= 2) argv = ["", "", "-"];
	try {
		for (let i = 2; i < argv.length; i++) {
			const fileName = argv[i];
			if (fileName === "-") {
				if (repl === undefined) {
					repl = new REPL();
					await repl.readEvalPrintLoop(interp);
				}
			} else {
				fs = fs || (await import("node:fs")).default;
				const text = fs.readFileSync(fileName, "utf8");
				run(interp, text);
			}
		}
	} catch (ex) {
		console.log(ex);
		process.exit(1);
	}
}

main();
