import type { Envelope } from "@repo/interpreter/channels";
import { bufferTransport } from "@repo/interpreter/channels-host";
import {
	type Bounded,
	type Compactor,
	compactorOf,
} from "@repo/interpreter/compaction";
import type { InterpExtension } from "@repo/interpreter/lisp";
import {
	EndOfFile,
	EvalException,
	Interp,
	jsonToLisp,
	newSym,
	prelude,
	runAsync,
	runSync,
} from "@repo/interpreter/lisp";
import {
	bankOf,
	type FiredMemory,
	fired,
	type MemoryBank,
	type MemoryObserver,
} from "@repo/interpreter/memory";
import { isTruncated } from "@repo/interpreter/prose";
import { type SecretsStore, storeOf } from "@repo/interpreter/secrets";
import { type Note, note } from "@repo/interpreter/topics";
import {
	joinMessages,
	rendered,
	sent,
	surfaceOf,
	type UiNode,
	type UiSurface,
} from "@repo/interpreter/ui";
import {
	isLlmExtension,
	type LlmExtension,
	type LlmObserver,
} from "@repo/llm/llm";
import { formsOnly } from "@repo/shared/lisp-forms";

export interface Repl {
	readonly interp: Interp;
	reset(): void;
}

export interface InMemoryRepl extends Repl {
	eval(code: string): Promise<string>;
}

export interface ReplOptions {
	extensions: InterpExtension[];
}

export interface EvalOutput extends Bounded {
	memories: FiredMemory[];
	failed: boolean;
	ui?: UiNode;
	message?: string;
}

interface StepResult extends EvalOutput {
	envelopes: readonly Envelope[];
	skipped: string[];
}

function partition(notes: readonly Note[]): {
	skipped: string[];
	failed: Note[];
} {
	const skipped: string[] = [];
	const failed: Note[] = [];
	for (const n of notes)
		switch (n.kind) {
			case "skipped":
				if (!skipped.includes(n.text)) skipped.push(n.text);
				break;
			case "failed":
				failed.push(n);
				break;
			default: {
				const unhandled: never = n.kind;
				throw new Error(`unhandled note kind ${String(unhandled)}`);
			}
		}
	return { skipped, failed };
}

function find<T>(
	extensions: readonly InterpExtension[],
	carried: (extension: InterpExtension) => T | undefined,
): T | undefined {
	for (const extension of extensions) {
		const value = carried(extension);
		if (value !== undefined) return value;
	}
	return undefined;
}

function skipNotes(skipped: string[]): string {
	return skipped.map((what) => `skipped ${what}\n`).join("");
}

function render(result: StepResult): EvalOutput {
	const notes = skipNotes(result.skipped);
	return {
		model: result.model + notes,
		user: result.user + notes,
		memories: result.memories,
		failed: result.failed,
		ui: result.ui,
		message: result.message,
	};
}

export class MemoryRepl implements InMemoryRepl {
	private currentInterp: Interp;
	private inFlight: Promise<void> = Promise.resolve();
	private readonly extensions: InterpExtension[];
	private readonly compactor?: Compactor;
	private readonly llm?: LlmExtension;
	readonly secrets?: SecretsStore;
	readonly memories?: MemoryBank;
	readonly surface?: UiSurface;

	constructor(options: ReplOptions) {
		this.extensions = options.extensions;
		this.compactor = find(this.extensions, compactorOf);
		this.secrets = find(this.extensions, storeOf);
		this.memories = find(this.extensions, bankOf);
		this.surface = find(this.extensions, surfaceOf);
		this.llm = this.extensions.find(isLlmExtension);
		this.currentInterp = this.freshInterp();
	}

	get interp(): Interp {
		return this.currentInterp;
	}

	get llmObserver(): LlmObserver | undefined {
		return this.llm?.observe;
	}

	set llmObserver(observer: LlmObserver | undefined) {
		if (this.llm) this.llm.observe = observer;
	}

	get memoryObserver(): MemoryObserver | undefined {
		return this.memories?.observer;
	}

	set memoryObserver(observer: MemoryObserver | undefined) {
		if (this.memories) this.memories.observer = observer;
	}

	private freshInterp(): Interp {
		const interp = new Interp({ extensions: this.extensions });
		runSync(interp, prelude);
		this.setup(interp);
		return interp;
	}

	protected setup(_interp: Interp): void {}

	async evalOutput(code: string): Promise<EvalOutput> {
		return render(await this.evaluate(code));
	}

	protected evaluate(code: string): Promise<StepResult> {
		return this.serialize(async () => {
			this.memories?.beginStep(code, this.currentInterp);
			try {
				await runAsync(this.currentInterp, code);
			} finally {
				this.memories?.endStep();
			}
		});
	}

	async invokeUi(
		action: string,
		values: Record<string, unknown> = {},
	): Promise<EvalOutput> {
		const surface = this.surface;
		if (surface === undefined)
			throw new EvalException("no ui surface on this repl", action, false);
		return this.serialize(() => surface.invoke(action, values));
	}

	private serialize(body: () => Promise<unknown>): Promise<StepResult> {
		const done = this.inFlight.then(
			() => this.runStep(body),
			() => this.runStep(body),
		);
		this.inFlight = done.then(
			() => undefined,
			() => undefined,
		);
		return done;
	}

	private async runStep(body: () => Promise<unknown>): Promise<StepResult> {
		this.compactor?.beginStep();
		const { channels } = this.currentInterp;
		channels.step += 1;
		const buffer = bufferTransport();
		const detach = channels.pipe(buffer);
		let thrown: unknown;
		try {
			await body();
		} catch (ex) {
			if (!(ex instanceof EvalException) && ex !== EndOfFile) throw ex;
			thrown = ex;
		} finally {
			detach();
		}
		const { skipped, failed } = partition(buffer.payloads(note));
		let error: Bounded = { model: "", user: "" };
		if (thrown === EndOfFile) {
			const text = "unbalanced expression (unexpected end of input)\n";
			error = { model: text, user: "" };
		} else if (thrown !== undefined) {
			const text = `${failed.at(-1)?.text ?? String(thrown)}\n`;
			error = this.compactor?.error(text) ?? { model: text, user: text };
		}
		return {
			envelopes: buffer.envelopes,
			model:
				buffer.text("model") + (this.compactor?.endStep() ?? "") + error.model,
			user: buffer.text("user") + error.user,
			memories: buffer.payloads(fired),
			failed: thrown !== undefined,
			ui: buffer.payloads(rendered).at(-1),
			message: joinMessages(buffer.payloads(sent)),
			skipped,
		};
	}

	async eval(code: string): Promise<string> {
		return (await this.evalOutput(code)).model;
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

	override async evalOutput(code: string): Promise<EvalOutput> {
		const result = await this.evaluate(code);
		if (!isAnswer(code, result)) return render(result);
		this.finished = true;
		this.pendingProse.push(...result.skipped);
		return {
			model: result.model,
			user: result.user,
			memories: result.memories,
			failed: result.failed,
			ui: result.ui,
			message: result.message,
		};
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

	clearTurnSignals(): void {
		this.finished = false;
		this.pendingProse = [];
	}

	override reset(): void {
		super.reset();
		this.clearTurnSignals();
	}
}

function isAnswer(code: string, { model, skipped }: StepResult): boolean {
	if (formsOnly(code).trim() === "") return true;
	if (model !== "" || skipped.length === 0) return false;
	return !isTruncated(code);
}

function defineVar(interp: Interp, name: string, value: unknown): void {
	interp.defineGlobal(newSym(name), jsonToLisp(value), {
		signature: name,
		doc: "Read-only live conversation state (auto-updated each step).",
	});
}
