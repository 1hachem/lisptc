import type { Doc } from "./docs.ts";
import { EvalException } from "./errors.ts";
import { Arg, BuiltInFunc, Closure, Lambda, Macro } from "./func.ts";
import type { Interp } from "./lisp.ts";
import {
	Cell,
	EndOfFile,
	LispKeyword,
	type List,
	newLispKeyword,
	newSym,
	Sym,
	Unspecified,
} from "./objects.ts";
import { str } from "./print.ts";
import { LispPromise } from "./promise.ts";
import { RecoveryError, type RecoveryFailure } from "./recovery.ts";
import type { ForeignValue } from "./types.ts";

export const IMAGE_FORMAT = 2;

export type Json =
	| null
	| boolean
	| number
	| string
	| Json[]
	| { [key: string]: Json };

export interface Image {
	readonly format: number;
	readonly objects: Json[];
	readonly globals: [Json, Json, string?][];
	readonly docs: Record<string, Doc>;
	readonly sources: Record<string, Json>;
}

export class ImageError extends Error {}

type Defined = Closure | Lambda | Macro;

function definedKind(x: Defined): "closure" | "lambda" | "macro" {
	if (x instanceof Closure) return "closure";
	if (x instanceof Macro) return "macro";
	return "lambda";
}

class Writer {
	readonly objects: Json[] = [];
	private readonly ids = new Map<object, number>();
	private readonly pending: [number, object][] = [];

	constructor(private readonly interp: Interp) {}

	value(x: unknown): Json {
		if (x === null || x === true || typeof x === "string") return x;
		if (x === undefined) return { c: "undefined" };
		if (typeof x === "bigint") return { n: x.toString() };
		if (typeof x === "number") return { f: Number.isFinite(x) ? x : String(x) };
		if (x instanceof Sym && x.isInterned) return { s: x.name };
		if (x instanceof LispKeyword) return { k: x.name };
		if (x === EndOfFile) return { c: "eof" };
		if (x === Unspecified) return { c: "unspecified" };
		if (x instanceof Arg)
			return { arg: [x.level, x.offset, this.value(x.symbol)] };
		if (typeof x === "object") return this.ref(x);
		throw new ImageError(`cannot image ${typeof x}: ${String(x)}`);
	}

	drain(): void {
		for (let next = this.pending.pop(); next; next = this.pending.pop()) {
			const [id, x] = next;
			this.objects[id] = this.object(x);
		}
	}

	private ref(x: object): Json {
		let id = this.ids.get(x);
		if (id === undefined) {
			id = this.objects.length;
			this.ids.set(x, id);
			this.objects.push(null);
			this.pending.push([id, x]);
		}
		return { "#": id };
	}

	private object(x: object): Json {
		if (x instanceof Cell)
			return { cell: [this.value(x.car), this.value(x.cdr)] };
		if (Array.isArray(x)) return { frame: Array.from(x, (e) => this.value(e)) };
		if (x instanceof Closure || x instanceof Lambda || x instanceof Macro)
			return {
				[definedKind(x)]: {
					carity: x.carity,
					keys: [...x.keys],
					body: this.value(x.body),
					env: x instanceof Closure ? this.value(x.env) : null,
				},
			};
		if (x instanceof Sym) return { sym: x.name };
		if (x instanceof LispPromise)
			return {
				promise: {
					state: x.state,
					outcome:
						x.state === "rejected"
							? reasonOf(x.outcome)
							: this.value(x.outcome),
					...(x.state === "pending" && x.recipe !== undefined
						? {
								resume: {
									kind: x.recipe.kind,
									args: x.recipe.args.map((a) => this.value(a)),
								},
							}
						: {}),
				},
			};
		if (x instanceof BuiltInFunc) return this.builtin(x);
		const foreign = this.interp.recovery.encode(x);
		if (foreign !== undefined) return foreignJson(foreign);
		throw new ImageError(`cannot image ${str(x)}: no kind claims it`);
	}

	private builtin(x: BuiltInFunc): Json {
		const name = x.callName ?? "";
		switch (x.identity.by) {
			case "name":
				return { builtin: name };
			case "foreign":
				return { ...foreignJson(x.identity.foreign), builtin: name };
			case "none":
				throw new ImageError(
					`${name} was made at run time and has no image form`,
				);
		}
	}
}

function reasonOf(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

export const INTERRUPTED = "interrupted by restore";

function foreignJson(foreign: ForeignValue): { [key: string]: Json } {
	return { foreign: { tag: foreign.tag, data: foreign.data as Json } };
}

export function snapshot(interp: Interp): Image {
	if (interp.importStack.length > 0)
		throw new ImageError(
			"cannot image an interpreter in the middle of an import",
		);
	try {
		interp.recovery.runBeforeSave();
	} catch (error) {
		if (error instanceof RecoveryError) throw new ImageError(error.message);
		throw error;
	}
	const writer = new Writer(interp);
	const { globals, docs, sources } = interp.contents();
	const image: Image = {
		format: IMAGE_FORMAT,
		objects: writer.objects,
		globals: globals.map(([sym, value, owner]) => {
			const entry: [Json, Json, string?] = [
				writer.value(sym),
				writer.value(value),
			];
			if (owner !== undefined) entry.push(owner);
			return entry;
		}),
		docs: Object.fromEntries(docs),
		sources: Object.fromEntries(
			sources.map(([name, form]) => [name, writer.value(form)]),
		),
	};
	writer.drain();
	return image;
}

function isRecord(x: Json): x is { [key: string]: Json } {
	return typeof x === "object" && x !== null && !Array.isArray(x);
}

function only(x: { [key: string]: Json }): [string, Json] {
	const [kind] = Object.keys(x);
	if (kind === undefined) throw new ImageError("empty image object");
	return [kind, x[kind] as Json];
}

interface Resumed {
	readonly into: LispPromise;
	readonly kind: string;
	readonly args: Json[];
}

class ImageReader {
	private readonly values: unknown[];
	readonly resumed: Resumed[] = [];
	private readonly builtins = new Map<string, BuiltInFunc>();

	constructor(
		private readonly interp: Interp,
		private readonly objects: Json[],
	) {
		this.values = new Array(objects.length);
		for (const [, value] of interp.contents().globals)
			if (value instanceof BuiltInFunc && value.callName !== undefined)
				if (!this.builtins.has(value.callName))
					this.builtins.set(value.callName, value);
	}

	read(): void {
		this.objects.forEach((json, id) => {
			if (!isRecord(json)) throw new ImageError(`bad image object ${id}`);
			if ("cell" in json) this.values[id] = new Cell(null, null);
			else if ("promise" in json) this.values[id] = new LispPromise();
			else if ("frame" in json)
				this.values[id] = new Array((json.frame as Json[]).length);
		});
		this.objects.forEach((json, id) => {
			if (this.values[id] === undefined)
				this.values[id] = this.immutable(json as { [key: string]: Json });
		});
		this.objects.forEach((json, id) => {
			const record = json as { [key: string]: Json };
			const target = this.values[id];
			if (target instanceof Cell) {
				const [car, cdr] = record.cell as [Json, Json];
				target.car = this.value(car);
				target.cdr = this.value(cdr);
			} else if (target instanceof LispPromise) {
				const { state, outcome, resume } = record.promise as {
					state: string;
					outcome: Json;
					resume?: { kind: string; args: Json[] };
				};
				if (state === "pending" && resume !== undefined) {
					this.resumed.push({ into: target, ...resume });
				} else if (state === "fulfilled") {
					target.state = "fulfilled";
					target.outcome = this.value(outcome);
				} else {
					target.state = "rejected";
					target.outcome = new Error(
						state === "rejected" ? (outcome as string) : INTERRUPTED,
					);
				}
			} else if (Array.isArray(target) && "frame" in record) {
				(record.frame as Json[]).forEach((e, i) => {
					target[i] = this.value(e);
				});
			}
		});
	}

	value(x: Json): unknown {
		if (x === null || x === true || typeof x === "string") return x;
		if (!isRecord(x))
			throw new ImageError(`bad image value ${JSON.stringify(x)}`);
		const [kind, body] = only(x);
		switch (kind) {
			case "#":
				return this.values[body as number];
			case "n":
				return BigInt(body as string);
			case "f":
				return typeof body === "string" ? Number(body) : body;
			case "s":
				return newSym(body as string);
			case "k":
				return newLispKeyword(body as string);
			case "c":
				return body === "eof"
					? EndOfFile
					: body === "unspecified"
						? Unspecified
						: undefined;
			case "arg": {
				const [level, offset, sym] = body as [number, number, Json];
				return new Arg(level, offset, this.value(sym) as Sym);
			}
			default:
				throw new ImageError(`unknown image value ${kind}`);
		}
	}

	private immutable(json: { [key: string]: Json }): unknown {
		if ("foreign" in json) return this.foreign(json);
		if ("builtin" in json) return this.builtin(json.builtin as string);
		const [kind, body] = only(json);
		if (kind === "sym") return new Sym(body as string);
		const fields = body as { [key: string]: Json };
		const carity = fields.carity as number;
		const keys = fields.keys as string[];
		const code = this.value(fields.body) as List;
		switch (kind) {
			case "closure":
				return new Closure(carity, code, this.value(fields.env) as List, keys);
			case "lambda":
				return new Lambda(carity, code, keys);
			case "macro":
				return new Macro(carity, code, keys);
			default:
				throw new ImageError(`unknown image object ${kind}`);
		}
	}

	private foreign(json: { [key: string]: Json }): unknown {
		const { tag, data } = json.foreign as { tag: string; data: Json };
		const name = typeof json.builtin === "string" ? json.builtin : undefined;
		const { recovery } = this.interp;
		if (recovery.decodes(tag)) return recovery.decode({ tag, data });
		if (name !== undefined) return gone(name);
		throw new ImageError(`no extension decodes ${tag}`);
	}

	private builtin(name: string): BuiltInFunc {
		return this.builtins.get(name) ?? gone(name);
	}
}

function gone(name: string): BuiltInFunc {
	return new BuiltInFunc(name, -1, () => {
		throw new EvalException("builtin no longer exists", name);
	});
}

export function kindsOf(image: Image): string[] {
	const kinds = new Set<string>();
	for (const json of image.objects) {
		if (!isRecord(json)) continue;
		if (isRecord(json.foreign ?? null) && !("builtin" in json))
			kinds.add((json.foreign as { tag: string }).tag);
		const resume = isRecord(json.promise ?? null)
			? (json.promise as { resume?: { kind: string } }).resume
			: undefined;
		if (resume !== undefined) kinds.add(resume.kind);
	}
	return [...kinds].sort();
}

export interface Restored {
	readonly failed: readonly RecoveryFailure[];
}

function interrupted(into: LispPromise, reason: string): void {
	into.state = "rejected";
	into.outcome = new Error(reason);
}

export function restore(interp: Interp, image: Image): Restored {
	if (image.format !== IMAGE_FORMAT)
		throw new ImageError(`image format ${image.format} is not ${IMAGE_FORMAT}`);
	const { recovery } = interp;
	const missing = kindsOf(image).filter(
		(kind) => !recovery.decodes(kind) && recovery.resumer(kind) === undefined,
	);
	if (missing.length > 0)
		throw new ImageError(`no extension restores ${missing.join(", ")}`);
	const reader = new ImageReader(interp, image.objects);
	reader.read();
	interp.load({
		globals: image.globals.map(
			([sym, value, owner]) =>
				[reader.value(sym) as Sym, reader.value(value), owner] as const,
		),
		docs: Object.entries(image.docs),
		sources: Object.entries(image.sources).map(
			([name, form]) => [name, reader.value(form)] as const,
		),
	});
	const failed = recovery.runAfterRestore();
	for (const { into, kind, args } of reader.resumed) {
		const resume = recovery.resumer(kind);
		if (resume === undefined) {
			interrupted(into, INTERRUPTED);
			continue;
		}
		const values = args.map((a) => reader.value(a));
		interp.async.resume(
			into,
			(signal) => Promise.resolve().then(() => resume(values, signal)),
			{ kind, args: values },
		);
	}
	return { failed };
}
