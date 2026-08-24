/** Host adapter for exposing an explicitly supplied set of tools to Lisptc. */
import {
	Cell,
	type Interp,
	type List,
	newSym,
	Sym,
} from "@repo/interpreter/lisp.ts";

export type HostCall = (tool: string, args: Record<string, unknown>) => unknown;

function arrayToList(values: unknown[]): List {
	let out: List = null;
	for (let i = values.length - 1; i >= 0; i--) out = new Cell(values[i], out);
	return out;
}

function jsonToLisp(value: unknown): unknown {
	if (value === null || value === undefined || value === false) return null;
	if (value === true || typeof value === "string" || typeof value === "number")
		return value;
	if (Array.isArray(value)) return arrayToList(value.map(jsonToLisp));
	if (typeof value === "object") {
		return arrayToList(
			Object.entries(value as Record<string, unknown>).map(
				([key, item]) => new Cell(key, jsonToLisp(item)),
			),
		);
	}
	return String(value);
}

function listToArray(value: List): unknown[] {
	const result: unknown[] = [];
	for (let item = value; item !== null; item = item.cdr as List)
		result.push(item.car);
	return result;
}

function lispToJson(value: unknown): unknown {
	if (
		value === null ||
		value === true ||
		typeof value === "string" ||
		typeof value === "number" ||
		typeof value === "boolean"
	)
		return value;
	if (typeof value === "bigint") return Number(value);
	if (value instanceof Sym) return value.name;
	if (value instanceof Cell) {
		const items = listToArray(value);
		const isAlist = items.every(
			(item) =>
				item instanceof Cell &&
				(typeof item.car === "string" || item.car instanceof Sym),
		);
		if (isAlist) {
			const object: Record<string, unknown> = {};
			for (const item of items as Cell[]) {
				const key = item.car instanceof Sym ? item.car.name : String(item.car);
				object[key] = lispToJson(item.cdr);
			}
			return object;
		}
		return items.map(lispToJson);
	}
	return String(value);
}

export interface HostToolSpec {
	hostName: string;
	lispName?: string;
	parameters: string[];
	defaults?: unknown[];
	parameterShapes?: Partial<Record<string, "array">>;
}

export function installHostTools(
	interp: Interp,
	toolSpecs: HostToolSpec[],
	call: HostCall,
): void {
	for (const spec of toolSpecs) {
		if (!/^[A-Za-z0-9_-]+$/.test(spec.hostName))
			throw new Error(`Invalid host tool name: ${spec.hostName}`);
		const lispName = spec.lispName ?? spec.hostName.replaceAll("_", "-");
		if (!/^[A-Za-z0-9_+*/<>=!?-]+$/.test(lispName))
			throw new Error(`Invalid Lisp tool name: ${lispName}`);
		const fn = interp.makeBuiltIn(lispName, -1, (frame) => {
			const supplied = listToArray(frame[0] as List);
			const args: Record<string, unknown> = {};
			for (let i = 0; i < spec.parameters.length; i++) {
				const value = i < supplied.length ? supplied[i] : spec.defaults?.[i];
				const parameter = spec.parameters[i];
				if (value !== undefined)
					args[parameter] =
						value === null &&
						i < supplied.length &&
						spec.parameterShapes?.[parameter] === "array"
							? []
							: lispToJson(value);
			}
			return jsonToLisp(call(spec.hostName, args));
		});
		interp.defineGlobal(newSym(lispName), fn, {
			signature: `(${lispName} ...)`,
			doc: `Call the host-authorized ${spec.hostName} tool.`,
		});
	}
}
