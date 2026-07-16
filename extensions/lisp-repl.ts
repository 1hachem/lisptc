/**
 * Lisp REPL Extension
 *
 * - Spawns the standalone Bakab Lisp REPL (src/lisp.ts) as a subprocess
 *   when the session starts; the interpreter itself has no pi dependency.
 * - Replaces the agent's system prompt with a lisp-only policy plus the
 *   full interpreter source code (src/arith.ts + src/lisp.ts).
 * - Registers a `lisp_eval` tool so the agent can evaluate snippets in
 *   the same REPL session (definitions persist across calls).
 * - /lisp-reset restarts the REPL process.
 */

import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
	type ExtensionAPI,
	highlightCode,
} from "@mariozechner/pi-coding-agent";
import { Container, Text } from "@mariozechner/pi-tui";
import { Type } from "@sinclair/typebox";

const SRC_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "src");
const LISP_PATH = join(SRC_DIR, "lisp.ts");
const PROMPT = "> ";
const EVAL_TIMEOUT_MS = 15_000;

function loadSource(): string {
	const arith = readFileSync(join(SRC_DIR, "arith.ts"), "utf8");
	const lisp = readFileSync(LISP_PATH, "utf8");
	return `### src/arith.ts\n\`\`\`typescript\n${arith}\n\`\`\`\n\n### src/lisp.ts\n\`\`\`typescript\n${lisp}\n\`\`\``;
}

const POLICY = `You are a Lisp machine. You are NOT a chat assistant.

ABSOLUTE RULES:
1. You may ONLY communicate by evaluating Lisp code through the \`lisp_eval\` tool.
2. You must NEVER write plain text, markdown, or explanations to the user. Your assistant text output must always be empty.
3. Every request from the user — questions, greetings, computations, anything — must be answered by writing and evaluating Lisp code in the REPL. Produce the answer as the VALUE of the last expression. Do NOT wrap it in \`print\`/\`princ\`: the REPL already prints the value of every expression, so printing it too shows it twice. Use \`print\`/\`princ\` only for side-effect output in the middle of a computation.
4. If something cannot be expressed in Lisp, respond by evaluating a Lisp expression whose value is an explanation string, e.g. "cannot comply".
5. The REPL session is persistent: functions and variables defined in one \`lisp_eval\` call remain available in later calls. Build on previous definitions.
6. Send complete, balanced expressions only. Each \`lisp_eval\` call is sent to the running REPL as-is.
7. Comments are FORBIDDEN. Never include \`;\` comments in the code you evaluate — the interpreter ignores them and emits a warning. Code must be self-explanatory without comments.
8. The dialect is Bakab Lisp (a Common-Lisp-like Lisp with macros, lexical scoping, and tail-call optimization). Its complete interpreter source code is given below — it is the authoritative definition of the language semantics, built-in functions, and the prelude. Consult it to know exactly what is available.

Below is the full source code of the interpreter you are running on:

`;

// `(print x)` writes x AND returns it, and the REPL prints the value of every
// expression — so the same text appears twice. Collapse that duplication here
// so the user sees it once.
function dedupePrintedValue(out: string): string {
	// Duplicated string value: print emits `"s"` and the REPL appends `"s"`
	// right after (possibly separated by a newline).
	const m = out.match(/^([\s\S]*?)(?:\n?)\1$/);
	if (m && m[1].trim() !== "") return m[1].trim();
	return out;
}

class LispRepl {
	private proc: ChildProcessWithoutNullStreams | null = null;
	private buffer = "";
	private waiter: ((out: string) => void) | null = null;

	async start(): Promise<void> {
		this.stop();
		this.proc = spawn(
			process.execPath,
			["--no-warnings", "--experimental-transform-types", LISP_PATH],
			{ stdio: ["pipe", "pipe", "pipe"], cwd: SRC_DIR },
		);
		this.proc.stdout.setEncoding("utf8");
		this.proc.stdout.on("data", (chunk: string) => {
			this.buffer += chunk;
			if (this.waiter && this.buffer.endsWith(PROMPT)) {
				const out = this.buffer.slice(0, -PROMPT.length);
				this.buffer = "";
				const w = this.waiter;
				this.waiter = null;
				w(out);
			}
		});
		// Wait for the initial "> " prompt.
		await this.waitForPrompt();
	}

	stop(): void {
		if (this.proc) {
			this.proc.kill();
			this.proc = null;
		}
		this.buffer = "";
		this.waiter = null;
	}

	get running(): boolean {
		return this.proc !== null && this.proc.exitCode === null;
	}

	private waitForPrompt(): Promise<string> {
		return new Promise<string>((resolve, reject) => {
			if (this.buffer.endsWith(PROMPT)) {
				const out = this.buffer.slice(0, -PROMPT.length);
				this.buffer = "";
				resolve(out);
				return;
			}
			const timer = setTimeout(() => {
				this.waiter = null;
				reject(
					new Error(
						`REPL did not return a prompt within ${EVAL_TIMEOUT_MS / 1000}s (unbalanced expression or infinite loop?). Use /lisp-reset to restart.`,
					),
				);
			}, EVAL_TIMEOUT_MS);
			this.waiter = (out) => {
				clearTimeout(timer);
				resolve(out);
			};
		});
	}

	async eval(code: string): Promise<string> {
		if (!this.running) await this.start();
		const pending = this.waitForPrompt();
		this.proc?.stdin.write(`${code.trim()}\n`);
		const out = await pending;
		// The REPL echoes continuation prompts ("  ") for multi-line input; strip trailing whitespace noise.
		return dedupePrintedValue(out.replace(/^(\s{2})+/, "").trim());
	}
}

export default function (pi: ExtensionAPI) {
	const repl = new LispRepl();
	let systemPrompt: string | null = null;

	pi.on("session_start", async (_event, ctx) => {
		// Disable every default/built-in tool; the agent gets lisp_eval only.
		pi.setActiveTools(["lisp_eval"]);
		await repl.start();
		ctx.ui.notify(
			"Lisp REPL started (persistent subprocess, lisp_eval is the only tool)",
			"info",
		);
	});

	pi.on("session_shutdown", async () => {
		repl.stop();
	});

	pi.on("before_agent_start", async () => {
		if (systemPrompt === null) {
			systemPrompt = POLICY + loadSource();
		}
		return { systemPrompt };
	});

	pi.registerCommand("lisp-reset", {
		description: "Restart the Lisp REPL (clears all definitions)",
		handler: async (_args, ctx) => {
			await repl.start();
			ctx.ui.notify("Lisp REPL restarted", "info");
		},
	});

	pi.registerTool({
		name: "lisp_eval",
		label: "Lisp Eval",
		description:
			"Evaluate Lisp code in the persistent session REPL. Accepts one or more complete expressions; " +
			"returns the REPL output (printed output and the value of each expression). Definitions persist across calls. " +
			"Sending `:up` re-enters the previous input line.",
		parameters: Type.Object({
			code: Type.String({
				description:
					"Lisp source code to evaluate (complete, balanced expressions)",
			}),
		}),

		// Code (call) and output (result) get distinct full-width backgrounds
		// so they are easy to tell apart in the TUI.
		renderCall(args, theme) {
			const box = new Container();
			box.addChild(new Text(theme.fg("toolTitle", theme.bold("λ lisp")), 0, 0));
			box.addChild(
				new Text(highlightCode(args.code, "lisp").join("\n"), 1, 0, (t) =>
					theme.bg("userMessageBg", t),
				),
			);
			return box;
		},

		renderResult(result, { isPartial }, theme) {
			if (isPartial) return new Text(theme.fg("warning", "evaluating…"), 0, 0);
			const out = result.content?.[0];
			const text = out?.type === "text" ? out.text : "(no output)";
			const isError =
				(result.details as { error?: boolean } | undefined)?.error === true;
			return new Text(
				theme.fg(isError ? "error" : "toolOutput", text),
				1,
				0,
				(t) => theme.bg(isError ? "toolErrorBg" : "toolSuccessBg", t),
			);
		},

		async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
			try {
				const output = await repl.eval(params.code);
				return {
					content: [{ type: "text", text: output || "(no output)" }],
					details: { code: params.code, output },
				};
			} catch (ex) {
				repl.stop();
				await repl.start();
				const msg = ex instanceof Error ? ex.message : String(ex);
				return {
					content: [
						{
							type: "text",
							text: `REPL error: ${msg} (interpreter was restarted, definitions lost)`,
						},
					],
					isError: true,
					details: { code: params.code, error: true },
				};
			}
		},
	});
}
