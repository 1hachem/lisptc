/**
 * Lisp REPL Extension
 *
 * - Spawns the standalone Lisptc REPL (src/lisp.ts) as a subprocess
 *   when the session starts; the interpreter itself has no pi dependency.
 * - Replaces the agent's system prompt with a lisp-only policy plus the
 *   full interpreter source code (src/arith.ts + src/lisp.ts).
 * - The agent has NO tools. Everything the agent outputs as assistant
 *   text is sent verbatim to the REPL and evaluated; the result is
 *   injected back into the session as a custom message.
 * - /lisp-reset restarts the REPL process.
 */

import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import {
	CustomEditor,
	type ExtensionAPI,
	highlightCode,
} from "@earendil-works/pi-coding-agent";
import { CURSOR_MARKER, Text } from "@earendil-works/pi-tui";

// The interpreter is a separate workspace package (@repo/interpreter) with
// no build step — its TypeScript sources are read/spawned directly. Resolve
// its `src` dir from the installed package rather than a relative path.
const require = createRequire(import.meta.url);
const SRC_DIR = join(
	dirname(require.resolve("@repo/interpreter/package.json")),
	"src",
);
const LISP_PATH = join(SRC_DIR, "lisp.ts");
const PROMPT = "> ";
// Kept above src/mcp.ts's 30s MCP-call timeout so a slow tool surfaces as a
// clean Lisp error rather than tripping this REPL-level restart path.
const EVAL_TIMEOUT_MS = 60_000;
const OUTPUT_TYPE = "lisp-output";
const CODE_TYPE = "lisp-code";

const ESC = String.fromCharCode(27);
// ANSI color/style sequences, e.g. "\x1b[32m"
const ANSI_COLOR_RE = new RegExp(`${ESC}\\[[0-9;]*m`, "g");
// The editor's inverse-video cursor cell: "\x1b[7m<grapheme>\x1b[0m"
const CURSOR_CELL_RE = new RegExp(`^${ESC}\\[7m[\\s\\S]*?${ESC}\\[0m`);

// Editor that live-highlights the input buffer as Lisp while it starts
// with "!" (the prefix that sends the line straight to the REPL).
//
// The base editor emits plain text lines plus a zero-width CURSOR_MARKER
// and an inverse-video cursor cell (\x1b[7m…\x1b[0m). Highlighting only
// inserts color codes, so visible widths — and thus cursor positioning
// and wrapping — are unchanged.
class LispEditor extends CustomEditor {
	// Called with the bare code when the user submits a "!" line. Intercepts
	// submission entirely, so pi's bash path (and its command-echo row)
	// never runs.
	onLisp?: (code: string) => void;

	constructor(...args: ConstructorParameters<typeof CustomEditor>) {
		super(...args);
		let inner: ((text: string) => void) | undefined;
		Object.defineProperty(this, "onSubmit", {
			get: () => (text: string) => {
				const trimmed = text.trimStart();
				if (trimmed.startsWith("!") && this.onLisp) {
					const code = trimmed.replace(/^!+\s*/, "");
					this.addToHistory(text);
					this.setText("");
					if (code !== "") this.onLisp(code);
					return;
				}
				inner?.(text);
			},
			set: (fn: ((text: string) => void) | undefined) => {
				inner = fn;
			},
		});
	}

	private hl(s: string): string {
		return s === "" ? s : (highlightCode(s, "lisp")[0] ?? s);
	}

	render(width: number): string[] {
		const lines = super.render(width);
		if (!this.getText().trimStart().startsWith("!")) return lines;

		const isBorder = (line: string) =>
			line.replace(ANSI_COLOR_RE, "").trimEnd().startsWith("─");
		let sawTopBorder = false;
		for (let i = 0; i < lines.length; i++) {
			const line = lines[i];
			if (isBorder(line)) {
				if (sawTopBorder) break; // bottom border: stop before autocomplete
				sawTopBorder = true;
				continue;
			}
			if (!sawTopBorder) continue;
			const markerIdx = line.indexOf(CURSOR_MARKER);
			if (markerIdx === -1) {
				lines[i] = this.hl(line);
				continue;
			}
			// Highlight around the cursor: before-part and after-part are
			// colored separately so the marker and the inverse-video cursor
			// cell stay byte-identical.
			const before = line.slice(0, markerIdx);
			const after = line.slice(markerIdx + CURSOR_MARKER.length);
			const cursorMatch = after.match(CURSOR_CELL_RE);
			if (!cursorMatch) {
				lines[i] = this.hl(before) + CURSOR_MARKER + after;
				continue;
			}
			const rest = after.slice(cursorMatch[0].length);
			lines[i] =
				this.hl(before) + CURSOR_MARKER + cursorMatch[0] + this.hl(rest);
		}
		return lines;
	}
}

function loadSource(): string {
	const arith = readFileSync(join(SRC_DIR, "arith.ts"), "utf8");
	const lisp = readFileSync(LISP_PATH, "utf8");
	const mcp = readFileSync(join(SRC_DIR, "mcp.ts"), "utf8");
	return `### src/arith.ts\n\`\`\`typescript\n${arith}\n\`\`\`\n\n### src/lisp.ts\n\`\`\`typescript\n${lisp}\n\`\`\`\n\n### src/mcp.ts\n\`\`\`typescript\n${mcp}\n\`\`\``;
}

const POLICY = `You are a Lisp machine. You are NOT a chat assistant.

Everything you output is fed DIRECTLY to a Lisp REPL and evaluated. You have no tools. Your entire output must be Lisp source code — nothing else.

ABSOLUTE RULES:
1. Your output is evaluated verbatim by the REPL. Output ONLY Lisp code: no plain text, no markdown, no code fences, no explanations. A single stray word outside an s-expression is a syntax error.
2. Every request from the user — questions, greetings, computations, anything — must be answered with Lisp code. Produce the answer as the VALUE of the last expression. Do NOT wrap it in \`print\`/\`princ\`: the REPL already prints the value of every expression. Use \`print\`/\`princ\` only for side-effect output in the middle of a computation.
3. If something cannot be expressed in Lisp, output a Lisp expression whose value is an explanation string, e.g. "cannot comply".
4. The REPL session is persistent: functions and variables defined in one message remain available in later messages. Build on previous definitions. Each evaluation result is sent back to you as a message of type ${OUTPUT_TYPE}.
5. Output complete, balanced expressions only.
6. Comments are FORBIDDEN. Never include \`;\` comments — the interpreter ignores them and emits a warning. Code must be self-explanatory without comments.
7. The dialect is Lisptc (a Common-Lisp-like Lisp with macros, lexical scoping, and tail-call optimization). Its complete interpreter source code is given below — it is the authoritative definition of the language semantics, built-in functions, and the prelude. Consult it to know exactly what is available.
8. MCP servers are available via built-ins registered in src/mcp.ts (included below): \`load-mcp\`, \`unload-mcp\`, \`list-mcps\`, \`list-tools\`, \`mcp-doc\`, \`search-tools\`. Load a predefined server by name — \`(load-mcp "linear")\` — or an ad-hoc one with a plist: a remote server \`(load-mcp :name "x" :url "https://..." :headers '(...))\`, or a local stdio server \`(load-mcp :name "fs" :command "npx" :args '("-y" "@modelcontextprotocol/server-filesystem" "/tmp"))\`. Each loaded tool becomes a global named \`<server>/<tool>\`, called with keyword args, e.g. \`(fs/read_file :path "/tmp/x")\`.

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
			{
				stdio: ["pipe", "pipe", "pipe"],
				cwd: SRC_DIR,
				// MCP_SERVERS (JSON array of predefined connection configs) is read
				// by src/mcp.ts at startup; `load-mcp` then expands them on demand.
				env: process.env,
			},
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

// Occasionally the model wraps its code in a markdown fence despite the
// policy; unwrap it so the REPL sees bare Lisp.
function stripFences(text: string): string {
	const m = text.trim().match(/^```[a-zA-Z]*\n([\s\S]*?)\n?```$/);
	return m ? m[1] : text.trim();
}

export default function (pi: ExtensionAPI) {
	const repl = new LispRepl();
	let systemPrompt: string | null = null;

	pi.on("session_start", async (_event, ctx) => {
		// The agent has no tools at all — its text output IS the Lisp program.
		pi.setActiveTools([]);
		await repl.start();
		// Live Lisp highlighting while typing in "!" mode; submitting a "!"
		// line evals it directly (code + result rendered as messages).
		ctx.ui.setEditorComponent((tui, theme, keybindings) => {
			const editor = new LispEditor(tui, theme, keybindings);
			editor.onLisp = async (code) => {
				const { output, error } = await evalCode(stripFences(code));
				sendWhenIdle(ctx, {
					customType: CODE_TYPE,
					content: code,
					display: true,
					details: {},
				});
				sendWhenIdle(ctx, {
					customType: OUTPUT_TYPE,
					content: output || "(no output)",
					display: true,
					details: { code, output, error },
				});
			};
			return editor;
		});
		ctx.ui.notify(
			"Lisp REPL started — assistant output is evaluated as Lisp, `! <code>` evals directly",
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

	async function evalCode(code: string): Promise<{
		output: string;
		error: boolean;
	}> {
		try {
			return { output: await repl.eval(code), error: false };
		} catch (ex) {
			repl.stop();
			await repl.start();
			const msg = ex instanceof Error ? ex.message : String(ex);
			return {
				output: `REPL error: ${msg} (interpreter was restarted, definitions lost)`,
				error: true,
			};
		}
	}

	// sendMessage only appends + displays immediately when the agent is
	// idle (otherwise it lands in steer/followUp queues and re-triggers or
	// disappears). Wait for idle before injecting REPL results.
	function sendWhenIdle(
		ctx: { isIdle(): boolean },
		message: Parameters<ExtensionAPI["sendMessage"]>[0],
	): void {
		if (ctx.isIdle()) pi.sendMessage(message);
		else setTimeout(() => sendWhenIdle(ctx, message), 50);
	}

	// Everything the agent says is a Lisp program: evaluate it and inject
	// the REPL output back into the session (displayed below the code with
	// its own background, and part of the agent's context).
	pi.on("message_end", async (event, ctx) => {
		if (event.message.role !== "assistant") return;
		const code = event.message.content
			.filter((c): c is { type: "text"; text: string } => c.type === "text")
			.map((c) => c.text)
			.join("\n");
		const trimmed = stripFences(code);
		if (trimmed === "") return;

		const { output, error } = await evalCode(trimmed);
		sendWhenIdle(ctx, {
			customType: OUTPUT_TYPE,
			content: output || "(no output)",
			display: true,
			details: { code: trimmed, output, error },
		});

		// Re-fence the code as ```lisp so the default markdown renderer
		// shows it syntax-highlighted instead of as plain prose.
		return {
			message: {
				...event.message,
				content: [
					...event.message.content.filter((c) => c.type !== "text"),
					{
						type: "text" as const,
						text: `\`\`\`lisp\n${trimmed}\n\`\`\``,
					},
				],
			},
		};
	});

	// User-entered "!" code renders syntax-highlighted on its own background,
	// distinct from the result background below it.
	pi.registerMessageRenderer(CODE_TYPE, (message, _options, theme) => {
		const code =
			typeof message.content === "string"
				? message.content
				: JSON.stringify(message.content);
		return new Text(highlightCode(code, "lisp").join("\n"), 1, 0, (t) =>
			theme.bg("userMessageBg", t),
		);
	});

	// REPL output gets its own background so it reads apart from the code.
	pi.registerMessageRenderer(OUTPUT_TYPE, (message, _options, theme) => {
		const details = message.details as { error?: boolean } | undefined;
		const isError = details?.error === true;
		const text =
			typeof message.content === "string"
				? message.content
				: JSON.stringify(message.content);
		return new Text(
			theme.fg(isError ? "error" : "toolOutput", text),
			1,
			0,
			(t) => theme.bg(isError ? "toolErrorBg" : "toolSuccessBg", t),
		);
	});

	pi.registerCommand("lisp-reset", {
		description: "Restart the Lisp REPL (clears all definitions)",
		handler: async (_args, ctx) => {
			await repl.start();
			ctx.ui.notify("Lisp REPL restarted", "info");
		},
	});

	pi.registerCommand("mcp", {
		description: "List MCP servers known to the Lisp REPL (loaded/unloaded)",
		handler: async (_args, ctx) => {
			const { output } = await evalCode("(list-mcps)");
			ctx.ui.notify(`MCP servers: ${output || "none"}`, "info");
		},
	});
}
