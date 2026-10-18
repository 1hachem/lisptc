import { fileURLToPath } from "node:url";
import { replEnv } from "@repo/env/repl";
import type { Ask, AskChoice } from "@repo/interpreter/asks";
import type { ChannelTransport } from "@repo/interpreter/channels";
import { bufferTransport } from "@repo/interpreter/channels-host";
import { setExit } from "@repo/interpreter/core-builtins";
import { EvalException, StepHold } from "@repo/interpreter/errors";
import { Interp, runAsync, runSync } from "@repo/interpreter/lisp";
import { EndOfFile } from "@repo/interpreter/objects";
import { prelude } from "@repo/interpreter/prelude";
import { Reader } from "@repo/interpreter/reader";
import { noAnnotations, openSession } from "@repo/interpreter/session";
import { type Note, note, output } from "@repo/interpreter/topics";
import { openAsks, question, runAsking } from "@repo/repl/asks";
import type { Repl } from "@repo/repl/repl";
import {
	connectOrSpawn,
	killSession,
	socketPathFor,
} from "@repo/repl/session-server";
import { formsOnly } from "@repo/shared/lisp-forms";
import { cliExtensions } from "./extensions.ts";

const SESSION_ENTRY = fileURLToPath(new URL("./session.ts", import.meta.url));

let readLine: (prompt: string) => Promise<string | null>;

const write = (s: string): void => {
	process.stdout.write(s);
};

const stdoutTransport = (): ChannelTransport => ({
	send(e) {
		if (e.topic === output.name) {
			if (e.to.includes("user")) write(String(e.payload));
		} else if (e.topic === note.name) {
			const n = e.payload as Note;
			if (n.kind === "skipped") write(`skipped ${n.text}\n`);
		}
		return true;
	},
});

class InteractiveRepl implements Repl {
	private currentInterp: Interp;
	private readonly extensions = cliExtensions();
	private readonly hooks = openSession(this.extensions);

	constructor() {
		this.currentInterp = this.freshInterp();
	}

	get interp(): Interp {
		return this.currentInterp;
	}

	private freshInterp(): Interp {
		const interp = new Interp({ extensions: this.extensions });
		runSync(interp, prelude);
		interp.channels.pipe(stdoutTransport());
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
				const refused = await runAsking({
					run: () => this.step(text),
					reply: (ask) => readLine(question(ask)),
					answer: (choice) => this.answer(choice),
				});
				for (const line of refused) write(`${line}\n`);
			} catch (ex) {
				if (ex instanceof EvalException) write(`${ex}\n`);
				else if (ex === EndOfFile)
					write("unbalanced expression (unexpected end of input)\n");
				else throw ex;
			}
		}
	}

	async step(code: string): Promise<readonly Ask[]> {
		const interp = this.currentInterp;
		const buffer = bufferTransport();
		const detach = interp.channels.pipe(buffer);
		try {
			await this.hooks.evalStep.run(
				async (ctx) => {
					await runAsync(ctx.interp, ctx.code);
				},
				{ interp, code, emit: write },
			);
		} catch (ex) {
			if (!(ex instanceof StepHold)) throw ex;
		} finally {
			detach();
		}
		return openAsks(
			this.hooks.annotate.run((_b, into) => into, buffer, noAnnotations()),
		);
	}

	private async answer(choice: AskChoice): Promise<void> {
		const { action, values } = choice.answer;
		await this.hooks.invoke.run(
			() => {
				throw new EvalException("no ui surface on this repl", action, false);
			},
			{ interp: this.currentInterp, action, values },
		);
	}
}

export function isComplete(text: string): boolean {
	const reader = new Reader();
	reader.push(formsOnly(text));
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
	const client = await connectOrSpawn(socketPathFor(), SESSION_ENTRY);
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
		const code = accum;
		accum = "";
		const refused = await runAsking({
			run: async () => {
				const { output, asks } = await client.step(code);
				write(output);
				return asks;
			},
			reply: (ask) => readLine(question(ask)),
			answer: async (choice) => {
				write(await client.answer(choice.answer.action, choice.answer.values));
			},
		});
		for (const line of refused) write(`${line}\n`);
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

	setExit(process.exit);

	if (args.includes("--attach")) {
		await attachLoop();
		return;
	}

	const repl = new InteractiveRepl();
	let started = false;
	let fs: typeof import("node:fs") | undefined;
	const launchDir = replEnv.INIT_CWD || process.cwd();
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
				let asks: readonly Ask[];
				try {
					asks = await repl.step(text);
				} finally {
					repl.interp.importStack.pop();
				}
				if (asks.length > 0) {
					const held = asks.map((ask) => ask.title).join(", ");
					console.error(
						`${fileName}: ${held} waits for approval, and a file cannot ask. Run it at the prompt, or allow it in the permissions config.`,
					);
					process.exit(1);
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
skipped with a note; a .ptc file argument is read strictly. A call
that waits for approval asks y/N at the prompt and runs the input again
once allowed; in a .ptc file it stops the run instead.

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
