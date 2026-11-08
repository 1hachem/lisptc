import { describe, expect, it, vi } from "vitest";

vi.mock("@repo/env/web", () => ({
	webEnv: { CONVEX_URL: "http://convex", CONVEX_SITE_URL: "http://site" },
}));

const { carriesAuthCookie, fromDesktop } = await import("../server/auth.ts");

describe("signed-out routing", () => {
	it("tells the desktop shell from its user agent", () => {
		expect(fromDesktop("Mozilla/5.0 Chrome/140 salsal-desktop/0.1.0")).toBe(
			true,
		);
		expect(fromDesktop("Mozilla/5.0 Chrome/140 Electron/43")).toBe(false);
		expect(fromDesktop(undefined)).toBe(false);
	});

	it("skips minting a token for a request with no auth cookie", () => {
		expect(carriesAuthCookie("ph_x=1; ui.panel=open")).toBe(false);
		expect(carriesAuthCookie(undefined)).toBe(false);
		expect(carriesAuthCookie("__Secure-better-auth.session_token=abc")).toBe(
			true,
		);
		expect(carriesAuthCookie("better-auth.convex_jwt=eyJ")).toBe(true);
	});
});
