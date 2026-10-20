import { COMPLETION_TRIGGERS } from "@repo/language-service";
import { describe, expect, it } from "vitest";
import { capabilities } from "../src/capabilities.ts";

describe("the server's capabilities", () => {
	it("trigger completion on the characters the chat input opens its menu on", () => {
		expect(capabilities.completionProvider?.triggerCharacters).toEqual([
			...COMPLETION_TRIGGERS,
		]);
	});
});
