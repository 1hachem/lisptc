import { describe, expect, it, vi } from "vitest";

vi.mock("../src/lib/appearance.tsx", () => ({}));
vi.mock("../src/lib/chat.tsx", () => ({}));
vi.mock("../src/lib/chats.ts", () => ({}));
vi.mock("../src/lib/model-picker.tsx", () => ({}));
vi.mock("../src/lib/transcript.ts", () => ({}));
vi.mock("../src/lib/ui.tsx", () => ({}));

const { commands, matchesCommand } = await import("../src/lib/commands.ts");

const typing = (query: string) =>
	commands.filter((c) => matchesCommand(c, query)).map((c) => c.name);

describe("the command list", () => {
	it("offers /new for what was typed of /clear", () => {
		expect(typing("clear")).toEqual(["/new"]);
		expect(typing("cl")).toEqual(["/new"]);
	});

	it("offers /new for its own name", () => {
		expect(typing("ne")).toEqual(["/new"]);
	});

	it("lists /clear only as an alias", () => {
		expect(commands.map((c) => c.name)).not.toContain("/clear");
	});
});
