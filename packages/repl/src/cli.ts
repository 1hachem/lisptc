import { MODEL } from "@repo/interpreter/channels";
import { Compactor, compactionExtension } from "@repo/interpreter/compaction";
import {
	EndOfFile,
	EvalException,
	Interp,
	prelude,
	Reader,
	runAsync,
	runSync,
	setExit,
	setWriter,
	stripProse,
} from "@repo/interpreter/lisp";
import { mcpExtension } from "@repo/interpreter/mcp";
import { proseExtension } from "@repo/interpreter/prose";
import { EnvSecretsStore, secretsExtension } from "@repo/interpreter/secrets";
import type { Repl } from "./repl.ts";
import {
	connectOrSpawn,
	killSession,
	socketPathFor,
} from "./session-server.ts";

let readLine: (prompt: string) => Promise<string | null>;

const write = (s: string): void => {
	process.stdout.write(s);
};

class InteractiveRepl implements Repl {
	private currentInterp: Interp;
	private compactor: Compactor = new Compactor();
	private readonly secretsStore = new EnvSecretsStore();

	constructor() {
		this.currentInterp = this.freshInterp();
	}

	get interp(): Interp {
		return this.currentInterp;
	}

	private freshInterp(): Interp {
		this.compactor = new Compactor();
		const interp = new Interp({
			extensions: [
				secretsExtension({ store: this.secretsStore, envFile: true }),
				mcpExtension(),
				compactionExtension(this.compactor),
				proseExtension(),
			],
		});
		runSync(interp, prelude);
		interp.channels.on(MODEL, (d) => {
			if (d.severity === "warning") write(`skipped ${d.text}\n`);
		});
		return interp;
	}

	reset(): void {
		this.currentInterp.dispose();
		this.currentInterp = this.freshInterp();
	}

	async readEvalPrintLoop(): Promise<void> {
		let buffer = "";
		for (;;) {
			const line = await readLine(buffer === "" ? "> " : "  ");
			if (line === null) {
				write("Goodbye\n");
				return;
			}
			buffer += `${line}\n`;
			if (!isComplete(buffer)) continue;
			const text = buffer;
			buffer = "";
			try {
				this.compactor.beginStep();
				await runAsync(this.currentInterp, text);
			} catch (ex) {
				if (ex instanceof EvalException) write(`${ex}\n`);
				else if (ex === EndOfFile)
					write("unbalanced expression (unexpected end of input)\n");
				else throw ex;
			}
		}
	}
}

export function isComplete(text: string): boolean {
	const reader = new Reader();
	reader.push(stripProse(text));
	while (!reader.isEmpty()) {
		try {
			reader.read();
		} catch (ex) {
			if (ex === EndOfFile) return false;
			return true;
		}
	}
	return true;
}

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

async function main(): Promise<void> {
	const { pathToFileURL } = await import("node:url");
	const entry = process.argv[1];
	if (!entry || import.meta.url !== pathToFileURL(entry).href) return;

	const args = process.argv.slice(2);

	if (args.includes("--help") || args.includes("-h")) {
		console.log(USAGE);
		return;
	}

	if (args.includes("--kill")) {
		const i = args.indexOf("--kill");
		const name = args[i + 1];
		const killed = await killSession(name);
		console.log(
			killed
				? `killed session${name ? ` "${name}"` : ""}`
				: `no session running${name ? ` for "${name}"` : ""}`,
		);
		return;
	}

	const CLEAR_SCREEN = "\x1b[2J\x1b[3J\x1b[H";

	const isTTY = process.stdin.isTTY === true;
	let rl: import("node:readline").Interface | null = null;
	let closed = false;
	let lastInput = "";
	const pending: string[] = [];
	let waiter: ((line: string | null) => void) | null = null;

	readLine = async (prompt) => {
		if (rl === null) {
			const { createInterface } = await import("node:readline");
			rl = createInterface({
				input: process.stdin,
				output: process.stdout,
				terminal: isTTY,
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
		if (line.trim() === ":clear" || line.trim() === "clear") {
			write(CLEAR_SCREEN);
			return "";
		}
		if (line.trim() === ":up" || line.trim() === "\x1b[A") {
			if (!isTTY && lastInput !== "") write(`${lastInput}\n`);
			return lastInput;
		}
		if (line.trim() !== "") lastInput = line;
		return line;
	};

	setWriter(write);
	setExit(process.exit);

	if (args.includes("--attach")) {
		await attachLoop();
		return;
	}

	const repl = new InteractiveRepl();
	let started = false;
	let fs: typeof import("node:fs") | undefined;
	const launchDir = process.env.INIT_CWD || process.cwd();
	const argv = args.length > 0 ? ["", "", ...args] : ["", "", "-"];
	try {
		for (let i = 2; i < argv.length; i++) {
			const fileName = argv[i];
			if (fileName === "-") {
				if (!started) {
					started = true;
					await repl.readEvalPrintLoop();
				}
			} else if (fileName.startsWith("--")) {
				console.error(`unknown option "${fileName}" (try --help)`);
				process.exit(1);
			} else {
				fs = fs || (await import("node:fs")).default;
				const path = await import("node:path");
				const abs = path.resolve(launchDir, fileName);
				const text = fs.readFileSync(abs, "utf8");
				repl.interp.importStack.push(path.dirname(abs));
				try {
					await runAsync(repl.interp, text);
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

const USAGE = `lisptc REPL — the Lisp interpreter's interactive terminal

Usage:
  pnpm repl [options] [file.ptc ...] [-]

With no arguments (or a bare "-") an interactive REPL starts. Each file
argument is run in order on the same interpreter — so a trailing "-"
keeps the files' state and drops you into a prompt afterwards. Secrets
(REPL_* env vars / nearest .env) and MCP are wired in both modes. At the
prompt, text around the forms is prose and a parenthesised aside is
skipped with a note; a .ptc file argument is read strictly.

Arguments:
  file.ptc        run a .ptc script; relative paths resolve against the
                  directory pnpm was invoked from
  -               start the interactive REPL (default with no arguments)

Options:
  -h, --help      show this help
  --attach        forward input to the shared session REPL instead of a
                  local interpreter (pnpm repl:attach)
  --kill [name]   stop the named (or default, cwd-keyed) session server
                  (pnpm repl:kill)`;

main();
