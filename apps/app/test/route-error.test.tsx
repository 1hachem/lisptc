// @vitest-environment happy-dom
import { ConvexError } from "convex/values";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeAll, describe, expect, it, vi } from "vitest";

const left = vi.hoisted(() => ({ to: [] as string[] }));

vi.mock("../src/lib/auth-client.ts", () => ({
	authClient: { signOut: async () => {} },
}));
vi.mock("../src/lib/analytics.tsx", () => ({ reportIssue: () => undefined }));
vi.mock("@tanstack/react-router", () => ({ Link: () => null }));

const { RouteError } = await import("../src/components/route-error.tsx");

beforeAll(() => {
	Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
	vi.spyOn(window.location, "replace").mockImplementation((to) => {
		left.to.push(String(to));
	});
});

async function failedWith(error: unknown): Promise<string> {
	left.to.length = 0;
	const host = document.createElement("div");
	await act(async () => {
		createRoot(host).render(
			<RouteError error={error as Error} reset={() => {}} info={undefined} />,
		);
	});
	await act(async () => {});
	return host.textContent ?? "";
}

describe("an error that means the session is gone", () => {
	it("is a token the deployment cannot decode", async () => {
		expect(
			await failedWith(
				new Error(
					`{"code":"InvalidAuthHeader","message":"Could not decode token. The JWT's 'kid' (key ID) header doesn't match any key in the provider's JWKS"}`,
				),
			),
		).toBe("");
		expect(left.to).toEqual(["/login"]);
	});

	it("is a caller the deployment does not know", async () => {
		expect(await failedWith(new ConvexError({ code: "UNAUTHENTICATED" }))).toBe(
			"",
		);
		expect(left.to).toEqual(["/login"]);
	});

	it("is an account whose user row was deleted", async () => {
		expect(await failedWith(new ConvexError({ code: "NOT_PROVISIONED" }))).toBe(
			"",
		);
		expect(left.to).toEqual(["/login"]);
	});

	it("is not any other failure, which shows and offers a retry", async () => {
		expect(await failedWith(new Error("something else"))).toContain(
			"something else",
		);
		expect(await failedWith(new ConvexError({ code: "FORBIDDEN" }))).toContain(
			"try again",
		);
		expect(left.to).toEqual([]);
	});
});
