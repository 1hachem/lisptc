import type { StateCodec } from "@repo/interpreter/lisp";
import { arrayToList } from "@repo/interpreter/objects";
import { itemsOf } from "./handles.ts";

export const EXPORTS_STATE = "agents/exports";

export const EXPORTS_GLOBAL = `*${EXPORTS_STATE}*`;

export interface Export {
	readonly name: string;
	readonly description: string;
}

export const exportsCodec: StateCodec<readonly Export[]> = {
	toLisp: (exports) =>
		arrayToList(
			exports.map(({ name, description }) => arrayToList([name, description])),
		),
	fromLisp: (x) =>
		itemsOf(x).flatMap((item) => {
			const [name, description] = itemsOf(item);
			return typeof name === "string" && typeof description === "string"
				? [{ name, description }]
				: [];
		}),
};

export function listed(exports: readonly Export[]): string {
	return exports
		.map(({ name, description }) => `  ${name}: ${description}`)
		.join("\n");
}
