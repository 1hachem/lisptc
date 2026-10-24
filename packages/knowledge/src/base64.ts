import { EvalException } from "@repo/interpreter/errors";

export function base64Bytes(name: string, encoded: unknown): Uint8Array {
	if (typeof encoded !== "string")
		throw new EvalException(`${name} takes :base64 as a string`, encoded);
	try {
		return Uint8Array.from(atob(encoded.replace(/\s+/g, "")), (c) =>
			c.charCodeAt(0),
		);
	} catch {
		throw new EvalException(`${name} :base64 is not base64`, encoded);
	}
}
