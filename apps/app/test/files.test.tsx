// @vitest-environment happy-dom
import type { Id } from "@repo/backend/dataModel";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@convex-dev/react-query", () => ({ convexQuery: () => ({}) }));
vi.mock("@tanstack/react-query", () => ({
	useQuery: () => ({
		data: '(permission/default ask)\n(permission/allow + - car)\n(permission/deny eval :reason "no")\n',
	}),
}));

import { PermissionPage } from "../src/components/permission-page.tsx";

beforeAll(() => {
	Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
});

function page(rule: number): string {
	const host = document.createElement("div");
	act(() =>
		createRoot(host).render(
			<PermissionPage workspaceId={"w1" as Id<"workspaces">} rule={rule} />,
		),
	);
	return host.textContent ?? "";
}

describe("a permission rule's page", () => {
	it("names each top-level rule by its verb and arguments", () => {
		expect(page(0)).toContain("permissions/default ask");
		expect(page(1)).toContain("permissions/allow + - car");
		expect(page(2)).toContain('permissions/deny eval :reason "no"');
		expect(page(3)).toContain("no such rule");
	});
});
