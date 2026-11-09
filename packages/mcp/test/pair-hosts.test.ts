import { describe, expect, it } from "vitest";
import { LocalProcessHost } from "../src/local-host.ts";

describe("a pair on a host without containers", () => {
	it("is refused, naming the host it needs", async () => {
		await expect(
			new LocalProcessHost().ensure({
				name: "playwright",
				image: "playwright-mcp",
				port: 8931,
				app: { image: "chromium-vnc" },
			}),
		).rejects.toThrow(/needs a container host/);
	});

	it("pipes an image without an app to its command, as a local process", async () => {
		await expect(
			new LocalProcessHost().ensure({
				name: "notes",
				image: "notes-mcp",
				port: 8000,
				command: "notes-mcp",
			}),
		).resolves.toHaveProperty("transport");
	});
});
