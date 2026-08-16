/**
 * Lisp REPL Extension
 *
 * - Runs the Lisptc interpreter in-process via the @repo/interpreter
 *   `AgentRepl` binding (no subprocess, no stdout scraping).
 * - Replaces the agent's system prompt with a lisp-only policy plus the
 *   full interpreter source code (src/arith.ts + src/lisp.ts).
 * - The agent has NO tools. Everything the agent outputs as assistant
 *   text is sent verbatim to the REPL and evaluated; the result is
 *   injected back into the session as a custom message.
 * - /lisp-reset clears all definitions (fresh interpreter).
 */

import { readFileSync } from "node:fs";
import {
	CustomEditor,
	type ExtensionAPI,
	highlightCode,
	type SessionEntry,
} from "@earendil-works/pi-coding-agent";
import { CURSOR_MARKER, Text } from "@earendil-works/pi-tui";
import { LISP_GRAMMAR } from "@repo/interpreter/grammar.ts";
import {
	FileJournal,
	type Journal,
	NullJournal,
} from "@repo/repl/journal.ts";
import { AgentRepl } from "@repo/repl/repl.ts";
import {
	CODE_TYPE,
	MAX_STEPS,
	OUTPUT_TYPE,
	SYSTEM_PROMPT,
} from "./system-prompt.ts";

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

// Where a session's Lisp is journaled. A local `.ptc` file by default (path
// from $LISPTC_SAVE_FILE, else `.lisptc/session.ptc`); persistence is disabled
// with LISPTC_SAVE_FILE=off. Swap in another Journal (S3, JuiceFS, …) here.
function defaultJournal(): Journal {
	const path = process.env.LISPTC_SAVE_FILE ?? ".lisptc/session.ptc";
	return path === "off" ? new NullJournal() : new FileJournal(path);
}

// The session prelude: durable `.ptc` memory loaded and evaluated at startup
// (identity/goal context via `(context! …)`, MCP loads, reusable defs). Path is
// $LISPTC_PRELUDE_FILE, else `.lisptc/prelude.ptc`. A missing file is fine.
function readSessionPrelude(): string {
	const path = process.env.LISPTC_PRELUDE_FILE ?? ".lisptc/prelude.ptc";
	try {
		return readFileSync(path, "utf8");
	} catch {
		return "";
	}
}

// Flatten a message's content into plain text: a raw string as-is, otherwise
// the concatenation of its text parts (images and other parts are dropped).
function messageText(content: unknown): string {
	if (typeof content === "string") return content;
	if (Array.isArray(content))
		return content
			.filter(
				(p): p is { type: "text"; text: string } =>
					typeof p === "object" &&
					p !== null &&
					(p as { type?: unknown }).type === "text",
			)
			.map((p) => p.text)
			.join("");
	return "";
}

// Build the read-only conversation snapshot injected into the REPL before each
// eval. `conversation` is the full ordered transcript (real messages plus this
// extension's own `lisp-code`/`lisp-output` custom messages, so the agent can
// search prior REPL output); the two filtered lists hold only real user/
// assistant message text. Each message is a plain object → a Lisp alist.
function snapshotConversation(ctx: {
	sessionManager: { getEntries(): SessionEntry[] };
}): Record<string, unknown> {
	const conversation: { role: string; content: string }[] = [];
	const userMessages: string[] = [];
	const assistantMessages: string[] = [];
	for (const entry of ctx.sessionManager.getEntries()) {
		if (entry.type === "message") {
			const { role } = entry.message;
			const content = messageText(
				(entry.message as { content?: unknown }).content,
			);
			conversation.push({ role, content });
			if (role === "user") userMessages.push(content);
			else if (role === "assistant") assistantMessages.push(content);
		} else if (entry.type === "custom_message") {
			conversation.push({
				role: entry.customType,
				content: messageText(entry.content),
			});
		}
	}
	return {
		conversation,
		"user-messages": userMessages,
		"assistant-messages": assistantMessages,
	};
}

// Build the message that carries a REPL evaluation back to the agent. A custom
// message is projected into the LLM context as a *user* message, which would
// read as if the human typed the output. To stop the agent mistaking a result
// for user input, the content is a JSON tool-result object it can recognize and
// parse; the raw output is kept in `details` for a clean TUI rendering.
function replResultMessage(
	code: string,
	output: string,
	error: boolean,
): {
	customType: string;
	content: string;
	display: boolean;
	details: { code: string; output: string; error: boolean };
} {
	const out = output || "(no output)";
	return {
		customType: OUTPUT_TYPE,
		content: JSON.stringify({
			type: "tool_result",
			source: "lisp-repl",
			error,
			output: out,
		}),
		display: true,
		details: { code, output: out, error },
	};
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
			{
				id: "accounts/fireworks/models/glm-5p2",
				name: "GLM 5.2",
				reasoning: false,
				input: ["text"],
				// Pricing/limits unknown; left at zero rather than guessing.
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
				contextWindow: 131072,
				maxTokens: 65536,
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

	const repl = new AgentRepl(defaultJournal());
	// Load durable memory: runs `(context! …)`/`(load-mcp …)`/defs at startup so
	// the agent boots with its identity, capabilities, and reusable functions.
	repl.loadSessionPrelude(readSessionPrelude());
	// Steps taken in the current REPL loop; reset when a new user task arrives.
	let steps = 0;

	// Refresh the read-only conversation globals from the live session before an
	// eval, so `conversation`/`user-messages`/`assistant-messages` always reflect
	// the current transcript.
	function refreshConversation(ctx: {
		sessionManager: { getEntries(): SessionEntry[] };
	}): void {
		repl.setConversationVars(snapshotConversation(ctx));
	}

	pi.on("session_start", async (_event, ctx) => {
		// The agent has no tools at all — its text output IS the Lisp program.
		pi.setActiveTools([]);
		// Live Lisp highlighting while typing in "!" mode; submitting a "!"
		// line evals it directly (code + result rendered as messages).
		ctx.ui.setEditorComponent((tui, theme, keybindings) => {
			const editor = new LispEditor(tui, theme, keybindings);
			editor.onLisp = async (code) => {
				refreshConversation(ctx);
				const { output, error } = evalCode(stripFences(code));
				sendWhenIdle(ctx, {
					customType: CODE_TYPE,
					content: code,
					display: true,
					details: {},
				});
				sendWhenIdle(ctx, replResultMessage(stripFences(code), output, error));
			};
			return editor;
		});
		ctx.ui.notify(
			"Lisp REPL started — assistant output is evaluated as Lisp, `! <code>` evals directly",
			"info",
		);
	});

	pi.on("before_agent_start", async () => {
		// Fold in any identity/goal context the session prelude contributed via
		// `(context! …)`, so durable memory shapes the agent's system prompt.
		const context = repl.systemContext();
		const systemPrompt = context
			? `${SYSTEM_PROMPT}\n\n${context}`
			: SYSTEM_PROMPT;
		return { systemPrompt };
	});

	// ReplSession renders Lisp errors into its output, so a throw here means an
	// unexpected host error; reset so corrupt state doesn't persist.
	function evalCode(code: string): { output: string; error: boolean } {
		try {
			return { output: repl.eval(code.trim()).trim(), error: false };
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

		refreshConversation(ctx);
		const { output, error } = evalCode(trimmed);
		steps += 1;

		// Drive the loop: unless the agent asked to stop with `(halt)` or we hit
		// the step cap, feed the result back WITH `triggerTurn` so the agent
		// runs again and emits the next step. Otherwise just display the result.
		const halted = repl.takeHalted();
		const keepLooping = !halted && steps < MAX_STEPS;
		const resultMessage = replResultMessage(trimmed, output, error);
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

	// REPL output gets its own background so it reads apart from the code. The
	// content is a JSON tool-result object (for the agent); display the raw
	// output from `details` so the user sees clean output, not the JSON wrapper.
	pi.registerMessageRenderer(OUTPUT_TYPE, (message, _options, theme) => {
		const details = message.details as
			| { error?: boolean; output?: string }
			| undefined;
		const isError = details?.error === true;
		const text =
			details?.output ??
			(typeof message.content === "string"
				? message.content
				: JSON.stringify(message.content));
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
