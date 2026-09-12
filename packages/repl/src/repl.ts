import { MODEL, USER } from "@repo/interpreter/channels";
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
	stripProse,
} from "@repo/interpreter/lisp";
import { isTruncated } from "@repo/interpreter/prose";
import { type SecretsStore, storeOf } from "@repo/interpreter/secrets";
import {
	isLlmExtension,
	type LlmExtension,
	type LlmObserver,
} from "@repo/llm/llm";
import { modelFacingExtensions } from "./extensions.ts";

export interface Repl {
	readonly interp: Interp;
	reset(): void;
}

export interface InMemoryRepl extends Repl {
	eval(code: string): Promise<string>;
}

export interface ReplOptions {
	extensions?: InterpExtension[];
}

interface EvalResult extends Bounded {
	skipped: string[];
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

function render({ model, user, skipped }: EvalResult): Bounded {
	const notes = skipNotes(skipped);
	return { model: model + notes, user: user + notes };
}

export class MemoryRepl implements InMemoryRepl {
	private currentInterp: Interp;
	private inFlight: Promise<void> = Promise.resolve();
	private readonly extensions: InterpExtension[];
	private readonly compactor?: Compactor;
	private readonly llm?: LlmExtension;
	readonly secrets?: SecretsStore;

	constructor(options: ReplOptions = {}) {
		this.extensions = options.extensions ?? modelFacingExtensions();
		this.compactor = find(this.extensions, compactorOf);
		this.secrets = find(this.extensions, storeOf);
		this.llm = this.extensions.find(isLlmExtension);
		this.currentInterp = this.freshInterp();
	}

	get interp(): Interp {
		return this.currentInterp;
	}

	get languageReference(): string {
		return this.currentInterp.prompts.text();
	}

	get llmObserver(): LlmObserver | undefined {
		return this.llm?.observe;
	}

	set llmObserver(observer: LlmObserver | undefined) {
		if (this.llm) this.llm.observe = observer;
	}

	private freshInterp(): Interp {
		const interp = new Interp({ extensions: this.extensions });
		runSync(interp, prelude);
		this.setup(interp);
		return interp;
	}

	protected setup(_interp: Interp): void {}

	async evalOutput(code: string): Promise<Bounded> {
		return render(await this.evaluate(code));
	}

	protected evaluate(code: string): Promise<EvalResult> {
		const done = this.inFlight.then(
			() => this.evaluateOne(code),
			() => this.evaluateOne(code),
		);
		this.inFlight = done.then(
			() => undefined,
			() => undefined,
		);
		return done;
	}

	private async evaluateOne(code: string): Promise<EvalResult> {
		this.compactor?.beginStep();
		let model = "";
		let user = "";
		const skipped: string[] = [];
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
		];
		let error: Bounded = { model: "", user: "" };
		try {
			await runAsync(this.currentInterp, code);
		} catch (ex) {
			if (ex instanceof EvalException) {
				const text = `${ex}\n`;
				error = this.compactor?.error(text) ?? { model: text, user: text };
			} else if (ex === EndOfFile) {
				const text = "unbalanced expression (unexpected end of input)\n";
				error = { model: text, user: text };
			} else throw ex;
		} finally {
			for (const off of unsubscribe) off();
		}
		return {
			model: model + (this.compactor?.endStep() ?? "") + error.model,
			user: user + error.user,
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

	override async evalOutput(code: string): Promise<Bounded> {
		const result = await this.evaluate(code);
		if (!isAnswer(code, result)) return render(result);
		this.finished = true;
		this.pendingProse.push(...result.skipped);
		return { model: result.model, user: result.user };
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
	interp.defineGlobal(newSym(name), jsonToLisp(value), {
		signature: name,
		doc: "Read-only live conversation state (auto-updated each step).",
	});
}
