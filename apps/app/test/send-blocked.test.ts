import { describe, expect, it } from "vitest";
import { sendBlocked } from "../src/lib/file-viewer.ts";

describe("asking about a stored file", () => {
	it("waits for a text file to load", () => {
		expect(sendBlocked("markdown", {})).toContain("still loading");
	});

	it("refuses a text file that failed to load", () => {
		expect(sendBlocked("text", { failure: "fetch failed (500)" })).toContain(
			"did not load",
		);
	});

	it("lets a loaded file through, empty or not", () => {
		expect(sendBlocked("text", { text: "" })).toBeUndefined();
		expect(sendBlocked("markdown", { text: "# a" })).toBeUndefined();
	});

	it("never waits on a file it does not read as text", () => {
		expect(sendBlocked("pdf", {})).toBeUndefined();
	});
});
