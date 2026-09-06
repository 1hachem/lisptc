import { MODEL, USER } from "@repo/interpreter/channels";
import {
	type Bounded,
	Compactor,
	compactionExtension,
	MAX_WORDS,
} from "@repo/interpreter/compaction";
import {
	Cell,
	EndOfFile,
	EvalException,
	Interp,
	type List,
	newSym,
	prelude,
	run,
	stripProse,
} from "@repo/interpreter/lisp";
import { mcpExtension } from "@repo/interpreter/mcp";
import { isTruncated, proseExtension } from "@repo/interpreter/prose";
import {
	EnvSecretsStore,
	type SecretsStore,
	secretsExtension,
} from "@repo/interpreter/secrets";
import {
	joinMessages,
	UI,
	type UiNode,
	UiSurface,
	uiExtension,
} from "@repo/interpreter/ui";

export interface EvalResult extends Bounded {
	skipped: string[];
	view?: UiNode;
	message?: string;
	error: boolean;
}

export interface Repl {
	readonly interp: Interp;
	reset(): void;
}

export interface InMemoryRepl extends Repl {
	eval(code: string): string;
}

function skipNotes(skipped: string[]): string {
	return skipped.map((what) => `skipped ${what}\n`).join("");
}

function render(result: EvalResult): EvalResult {
	const notes = skipNotes(result.skipped);
	return {
		...result,
		model: result.model + notes,
		user: result.user + notes,
	};
}

function jsToLisp(value: unknown): unknown {
	if (value === null || value === undefined) return null;
	if (value === true) return true;
	if (value === false) return null;
	if (typeof value === "number" || typeof value === "bigint") return value;
	if (typeof value === "string") return value;
	if (Array.isArray(value)) return arrayToList(value.map(jsToLisp));
	if (typeof value === "object") {
		const pairs = Object.entries(value as Record<string, unknown>).map(
			([k, v]) => new Cell(k, jsToLisp(v)),
		);
		return arrayToList(pairs);
	}
	return String(value);
}

function arrayToList(arr: unknown[]): List {
	let out: List = null;
	for (let i = arr.length - 1; i >= 0; i--) out = new Cell(arr[i], out);
	return out;
}

export class MemoryRepl implements InMemoryRepl {
	private currentInterp: Interp;
	private compactor: Compactor;
	private surface: UiSurface;
	readonly secrets: SecretsStore;
	private readonly wordLimit: number;

	constructor(
		options: { wordLimit?: number; secretsStore?: SecretsStore } = {},
	) {
		this.wordLimit = options.wordLimit ?? MAX_WORDS;
		this.compactor = new Compactor(this.wordLimit);
		this.surface = new UiSurface();
		this.secrets = options.secretsStore ?? new EnvSecretsStore();
		this.currentInterp = this.freshInterp();
	}

	get interp(): Interp {
		return this.currentInterp;
	}

	get ui(): UiSurface {
		return this.surface;
	}

	private freshInterp(): Interp {
		this.compactor = new Compactor(this.wordLimit);
		this.surface = new UiSurface();
		const interp = new Interp({
			extensions: [
				secretsExtension({ store: this.secrets }),
				mcpExtension(),
				compactionExtension(this.compactor),
				uiExtension(this.surface),
				proseExtension(),
			],
		});
		run(interp, prelude);
		this.setup(interp);
		return interp;
	}

	protected setup(_interp: Interp): void {}

	evalOutput(code: string): EvalResult {
		return render(this.evaluate(code));
	}

	protected evaluate(code: string): EvalResult {
		return this.capture(() => {
			run(this.currentInterp, code);
		});
	}

	invokeUi(action: string, values: Record<string, unknown> = {}): EvalResult {
		return this.capture(() => this.surface.invoke(action, values));
	}

	private capture(body: () => void): EvalResult {
		this.compactor.beginStep();
		let model = "";
		let user = "";
		const skipped: string[] = [];
		let view: UiNode | undefined;
		const messages: string[] = [];
		const { channels } = this.currentInterp;
		const unsubscribe = [
			channels.on(USER, (d) => {
				user += d.text;
			}),
			channels.on(MODEL, (d) => {
				if (d.severity === "warning") {
					if (!skipped.includes(d.text)) skipped.push(d.text);
					return;
				}
				if (d.severity === undefined) model += d.text;
			}),
			channels.on(UI, (d) => {
				const event = d.value;
				if (event === undefined || event === null) return;
				const ui = event as { kind: string; node?: UiNode; text?: string };
				if (ui.kind === "view") view = ui.node;
				else if (ui.kind === "message" && ui.text !== undefined)
					messages.push(ui.text);
			}),
		];
		let error: Bounded = { model: "", user: "" };
		let failed = false;
		try {
			body();
		} catch (ex) {
			failed = true;
			if (ex instanceof EvalException) error = this.compactor.error(`${ex}\n`);
			else if (ex === EndOfFile) {
				const text = "unbalanced expression (unexpected end of input)\n";
				error = { model: text, user: text };
			} else throw ex;
		} finally {
			for (const off of unsubscribe) off();
		}
		return {
			model: model + this.compactor.endStep() + error.model,
			user: user + error.user,
			skipped,
			view,
			message: joinMessages(messages),
			error: failed,
		};
	}

	eval(code: string): string {
		return this.evalOutput(code).model;
	}

	reset(): void {
		this.currentInterp.dispose();
		this.currentInterp = this.freshInterp();
	}
}

export class AgentRepl extends MemoryRepl {
	private finished = false;
	private pendingProse: string[] = [];
	private readonly conversationVars = new Map<string, unknown>();

	protected override setup(interp: Interp): void {
		const vars = this.conversationVars;
		if (vars) for (const [name, value] of vars) defineVar(interp, name, value);
	}

	override evalOutput(code: string): EvalResult {
		const result = this.evaluate(code);
		if (!isAnswer(code, result)) return render(result);
		this.finished = true;
		this.pendingProse.push(...result.skipped);
		return { ...result, skipped: [] };
	}

	setConversationVars(vars: Record<string, unknown>): void {
		this.conversationVars.clear();
		for (const [name, value] of Object.entries(vars)) {
			this.conversationVars.set(name, value);
			defineVar(this.interp, name, value);
		}
	}

	takeFinished(): boolean {
		const f = this.finished;
		this.finished = false;
		return f;
	}

	takeProseFeedback(): string {
		const notes = this.pendingProse;
		this.pendingProse = [];
		return skipNotes(notes);
	}

	override reset(): void {
		super.reset();
		this.finished = false;
		this.pendingProse = [];
	}
}

function isAnswer(code: string, { user, skipped }: EvalResult): boolean {
	if (stripProse(code).trim() === "") return true;
	if (user !== "" || skipped.length === 0) return false;
	return !isTruncated(code);
}

function defineVar(interp: Interp, name: string, value: unknown): void {
	interp.defineGlobal(newSym(name), jsToLisp(value), {
		signature: name,
		doc: "Read-only live conversation state (auto-updated each step).",
	});
}
