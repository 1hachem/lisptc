// @vitest-environment happy-dom
import type { Id } from "@repo/backend/dataModel";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeAll, describe, expect, it, vi } from "vitest";

const saved = vi.hoisted(() => ({ text: "" }));

vi.mock("@convex-dev/react-query", () => ({
	convexQuery: () => ({}),
}));
vi.mock("@tanstack/react-query", () => ({
	useQuery: () => ({ data: saved.text }),
}));

import { SourcePage } from "../src/components/source-page.tsx";
import { definitionOf } from "../src/lib/agent-definition.ts";

beforeAll(() => {
	Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
});

function page(text: string): string {
	saved.text = text;
	const host = document.createElement("div");
	act(() =>
		createRoot(host).render(
			<SourcePage
				workspaceId={"w1" as Id<"workspaces">}
				folder="agents"
				name="reader"
			/>,
		),
	);
	return host.textContent ?? "";
}

describe("reading a saved sub-agent", () => {
	it("gives its name, instructions, budget and permission rules", () => {
		const definition = definitionOf(
			'(defagent "reader"\n  :prompt "read the docs"\n  :permissions "(permission/deny eval) (permission/ask fs/write)"\n  :budget 40)',
		);
		expect(definition).toMatchObject({
			name: "reader",
			prompt: "read the docs",
			budget: "40",
		});
		expect(definition?.rules.map((rule) => rule.source)).toEqual([
			"(permission/deny eval)",
			"(permission/ask fs/write)",
		]);
	});

	it("shows a saved agent's name and options", () => {
		const text = page(
			'(defagent "reader"\n  :prompt "read it"\n  :permissions "(permission/deny \\"fs/*\\")"\n  :budget 40)',
		);
		expect(text).toContain("reader");
		expect(text).toContain("read it");
		expect(text).toContain("40 steps");
		expect(text).toContain("fs/*");
	});

	it("shows a definition saved with a :roster, leaving the roster out", () => {
		const text = page(
			'(defagent "lead"\n  :prompt "lead"\n  :roster \'("scout")\n  :budget 9)',
		);
		expect(text).toContain("9 steps");
		expect(text).not.toContain("scout");
	});

	it("shows no step cap and the workspace rules for a bare definition", () => {
		const text = page('(defagent "bare" :prompt "go")');
		expect(text).toContain("bare");
		expect(text).toContain("no cap");
		expect(text).toContain("same as the workspace");
	});

	it("says it cannot read text that is not a definition", () => {
		for (const source of [
			'"just text"',
			"(permission/deny eval)",
			"(defagent reader)",
			"(defagent",
		])
			expect(page(source)).toContain("this definition could not be read");
	});
});
