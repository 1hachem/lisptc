import { Interp } from "@repo/interpreter/lisp";
import { LANGUAGE_MEMORIES } from "@repo/interpreter/source";
import { memoryHost } from "../src/memory-host.ts";
import type { MemoryHost } from "../src/ports.ts";

export const bareHost: MemoryHost = { ...memoryHost, memories: () => "" };

export class MemoryInterp extends Interp {
	override builtinMemories(): readonly string[] {
		return super.builtinMemories().filter((text) => text !== LANGUAGE_MEMORIES);
	}
}
