import { describe, expect, it, vi } from "vitest";
import { landInApp } from "../src/lib/land.ts";

describe("landing in the app after sign in", () => {
	it("loads the app as a full page so the server renders it with its data", () => {
		const replace = vi.fn();
		landInApp({ replace });
		expect(replace).toHaveBeenCalledWith("/app");
	});
});
