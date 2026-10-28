import { describe, expect, it, vi } from "vitest";

vi.mock("@repo/env/web", () => ({
	webEnv: { CONVEX_URL: "http://convex", CONVEX_SITE_URL: "http://site" },
}));

const { carriesAuthCookie, fromDesktop } = await import("../server/auth.ts");
const { signedOutPage } = await import("../src/lib/signed-out.ts");

describe("signed-out routing", () => {
	it("shows the landing to a signed-out browser at /", () => {
		expect(signedOutPage("/", false)).toBe("landing");
	});

	it("sends a signed-out desktop at / to login", () => {
		expect(signedOutPage("/", true)).toBe("login");
	});

	it("sends any other signed-out path to login", () => {
		expect(signedOutPage("/w1/chats", false)).toBe("login");
		expect(signedOutPage("/w1/chats", true)).toBe("login");
	});

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
