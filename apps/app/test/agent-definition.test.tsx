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
