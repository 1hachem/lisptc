/**
 * Lisp REPL Extension
 *
 * - Runs the Lisptc interpreter in-process via the @repo/interpreter
 *   `ReplSession` binding (no subprocess, no stdout scraping).
 * - Replaces the agent's system prompt with a lisp-only policy plus the
 *   full interpreter source code (src/arith.ts + src/lisp.ts).
 * - The agent has NO tools. Everything the agent outputs as assistant
 *   text is sent verbatim to the REPL and evaluated; the result is
 *   injected back into the session as a custom message.
 * - /lisp-reset clears all definitions (fresh interpreter).
 */

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import {
	CustomEditor,
	type ExtensionAPI,
	highlightCode,
} from "@earendil-works/pi-coding-agent";
import { CURSOR_MARKER, Text } from "@earendil-works/pi-tui";
import { ReplSession } from "@repo/interpreter";
import { LISP_GRAMMAR } from "@repo/interpreter/grammar.ts";

// Resolve the interpreter package's `src` dir to read the source we embed
// into the system prompt (the interpreter itself runs via ReplSession above).
const require = createRequire(import.meta.url);
const SRC_DIR = join(
	dirname(require.resolve("@repo/interpreter/package.json")),
	"src",
);
const LISP_PATH = join(SRC_DIR, "lisp.ts");
const OUTPUT_TYPE = "lisp-output";
const CODE_TYPE = "lisp-code";

// The agent runs as a REPL loop: each Lisp answer is evaluated and its result
// fed back to trigger the next step. The loop ends when the agent calls
// `(halt)` or after this many steps (a runaway safeguard).
const MAX_STEPS = 25;

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
4a. You run in a LOOP. Emit ONE Lisp form (or a small group), receive its ${OUTPUT_TYPE} result, then you are automatically asked to continue. Use each result to decide the next step: inspect data, branch, retry, build up state — one step at a time. Do not try to do everything in a single message; take a step, look at the result, then take the next.
4b. When the user's request is FULLY satisfied, call \`(halt)\` to end the loop; return a final value with \`(halt <expr>)\`. Do NOT call \`(halt)\` before the task is complete. The loop also stops automatically after ${MAX_STEPS} steps.
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
	private session = new ReplSession();

	reset(): void {
		this.session.reset();
	}

	eval(code: string): string {
		return dedupePrintedValue(this.session.eval(code.trim()).trim());
	}

	// Did the just-evaluated program call `(halt)`? The REPL session owns the
	// `halt` built-in and its flag; this just surfaces it (see message_end).
	takeHalted(): boolean {
		return this.session.takeHalted();
	}
}

// Occasionally the model wraps its code in a markdown fence despite the
// policy; unwrap it so the REPL sees bare Lisp.
function stripFences(text: string): string {
	const m = text.trim().match(/^```[a-zA-Z]*\n([\s\S]*?)\n?```$/);
	return m ? m[1] : text.trim();
}

// Register Fireworks as an OpenAI-compatible provider. Fireworks ships as a
// built-in pi provider; registering it here replaces its model list with the
// models we care about and pins the API-key env var. Grammar-based structured
// output (docs.fireworks.ai/structured-responses/structured-output-grammar-based)
// is a per-request `response_format` feature, not a provider setting, so it is
// not configured here.
function registerFireworks(pi: ExtensionAPI): void {
	pi.registerProvider("fireworks", {
		baseUrl: "https://api.fireworks.ai/inference/v1",
		apiKey: "$FIREWORKS_API_KEY",
		api: "openai-completions",
		models: [
			{
				id: "accounts/fireworks/models/kimi-k3",
				name: "Kimi K3",
				// Thinking off at the provider level: declaring the model
				// non-reasoning makes pi clamp its thinking level to off, so no
				// `:off` CLI suffix is needed.
				reasoning: false,
				// Kimi K3 is multimodal — it accepts image_url content parts.
				input: ["text", "image"],
				// Pricing unknown for K3; left at zero rather than guessing.
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
				contextWindow: 262144,
				maxTokens: 131072,
			},
		],
	});
}

export default function (pi: ExtensionAPI) {
	registerFireworks(pi);

	// Constrain every reply to valid lisptc source via Fireworks grammar-based
	// structured output. The payload is the OpenAI-compatible request body;
	// returning it replaces what pi sends over the wire.
	pi.on("before_provider_request", async (event) => {
		const payload = event.payload;
		if (typeof payload !== "object" || payload === null) return;
		(payload as { response_format?: unknown }).response_format = {
			type: "grammar",
			grammar: LISP_GRAMMAR,
		};
		return payload;
	});

	const repl = new LispRepl();
	let systemPrompt: string | null = null;
	// Steps taken in the current REPL loop; reset when a new user task arrives.
	let steps = 0;

	pi.on("session_start", async (_event, ctx) => {
		// The agent has no tools at all — its text output IS the Lisp program.
		pi.setActiveTools([]);
		// Live Lisp highlighting while typing in "!" mode; submitting a "!"
		// line evals it directly (code + result rendered as messages).
		ctx.ui.setEditorComponent((tui, theme, keybindings) => {
			const editor = new LispEditor(tui, theme, keybindings);
			editor.onLisp = async (code) => {
				const { output, error } = evalCode(stripFences(code));
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

	pi.on("before_agent_start", async () => {
		if (systemPrompt === null) {
			systemPrompt = POLICY + loadSource();
		}
		return { systemPrompt };
	});

	// ReplSession renders Lisp errors into its output, so a throw here means an
	// unexpected host error; reset so corrupt state doesn't persist.
	function evalCode(code: string): { output: string; error: boolean } {
		try {
			return { output: repl.eval(code), error: false };
		} catch (ex) {
			repl.reset();
			const msg = ex instanceof Error ? ex.message : String(ex);
			return {
				output: `REPL error: ${msg} (interpreter was reset, definitions lost)`,
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

	// The agent has no tools and its answer is grammar-constrained to lisptc, so
	// the assistant's text IS a Lisp program: eval it and inject the REPL output
	// back into the session. Only the `text` parts are the grammar-constrained
	// answer; Kimi's reasoning arrives as separate `thinking` parts the grammar
	// cannot reach (Fireworks exposes no switch to disable it on the OpenAI-
	// compatible endpoint), so those are excluded from eval and dropped from the
	// transcript rather than fed to the REPL as non-Lisp prose.
	pi.on("message_end", async (event, ctx) => {
		const msg = event.message as { role: string; customType?: string };
		// A genuine user prompt (not one of our injected results) starts a new
		// task — reset the step budget so each request gets a fresh loop.
		if (msg.role === "user" && msg.customType === undefined) steps = 0;
		if (event.message.role !== "assistant") return;
		const code = event.message.content
			.filter((c): c is { type: "text"; text: string } => c.type === "text")
			.map((c) => c.text)
			.join("\n");
		const trimmed = stripFences(code);
		if (trimmed === "") return;

		const { output, error } = evalCode(trimmed);
		steps += 1;

		// Drive the loop: unless the agent asked to stop with `(halt)` or we hit
		// the step cap, feed the result back WITH `triggerTurn` so the agent
		// runs again and emits the next step. Otherwise just display the result.
		const halted = repl.takeHalted();
		const keepLooping = !halted && steps < MAX_STEPS;
		const resultMessage = {
			customType: OUTPUT_TYPE,
			content: output || "(no output)",
			display: true,
			details: { code: trimmed, output, error },
		};
		if (keepLooping) {
			pi.sendMessage(resultMessage, { triggerTurn: true });
		} else {
			sendWhenIdle(ctx, resultMessage);
			if (!halted && steps >= MAX_STEPS)
				ctx.ui.notify(`Lisp loop stopped after ${MAX_STEPS} steps`, "warning");
		}

		// Re-fence the code as ```lisp so the default markdown renderer
		// shows it syntax-highlighted instead of as plain prose. Drop the
		// original text/thinking parts (folded into `trimmed`); keep anything
		// else (e.g. images) untouched.
		return {
			message: {
				...event.message,
				content: [
					...event.message.content.filter(
						(c) => c.type !== "text" && c.type !== "thinking",
					),
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
		description: "Reset the Lisp REPL (clears all definitions)",
		handler: async (_args, ctx) => {
			repl.reset();
			ctx.ui.notify("Lisp REPL reset", "info");
		},
	});

	pi.registerCommand("mcp", {
		description: "List MCP servers known to the Lisp REPL (loaded/unloaded)",
		handler: async (_args, ctx) => {
			const { output } = evalCode("(list-mcps)");
			ctx.ui.notify(`MCP servers: ${output || "none"}`, "info");
		},
	});
}
