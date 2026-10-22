import { ConvexError } from "convex/values";
import { describe, expect, it, vi } from "vitest";

vi.mock("../src/lib/auth-client.ts", () => ({ authClient: {} }));
vi.mock("../src/lib/analytics.tsx", () => ({ reportIssue: () => undefined }));

const { rejectsSession } = await import("../src/components/route-error.tsx");

describe("an error that means the session is gone", () => {
	it("is a token the deployment cannot decode", () => {
		expect(
			rejectsSession(
				new Error(
					`{"code":"InvalidAuthHeader","message":"Could not decode token. The JWT's 'kid' (key ID) header doesn't match any key in the provider's JWKS"}`,
				),
			),
		).toBe(true);
	});

	it("is a caller the deployment does not know", () => {
		expect(rejectsSession(new ConvexError({ code: "UNAUTHENTICATED" }))).toBe(
			true,
		);
	});

	it("is not any other failure", () => {
		expect(rejectsSession(new ConvexError({ code: "FORBIDDEN" }))).toBe(false);
		expect(rejectsSession(new Error("something else"))).toBe(false);
	});
});
