import { mkdtempSync, readdirSync, statSync } from "node:fs";
import { networkInterfaces, tmpdir } from "node:os";
import { join } from "node:path";
import { boot, Interp, runAsync } from "@repo/interpreter/lisp";
import { str } from "@repo/interpreter/print";
import { describe, expect, it, vi } from "vitest";
import { mcpExtension } from "../src/mcp.ts";
import { finishAuthorization, mcpHostFor } from "../src/mcp-host.ts";
import {
	CallbackServer,
	createAuthCallback,
	sharedAuthCallback,
} from "../src/mcp-oauth.ts";
import { FileOAuthStore } from "../src/oauth-host.ts";

function tmpDir(): string {
	return mkdtempSync(join(tmpdir(), "lisptc-oauth-"));
}

describe("FileOAuthStore", () => {
	it("keeps a login on disk for a later session, and logout clears it", async () => {
		const dir = tmpDir();
		await new FileOAuthStore(dir).save("https://mcp.linear.app", {
			tokens: { access_token: "at", token_type: "Bearer" },
		});
		const interp = new Interp({
			extensions: [
				mcpExtension(mcpHostFor({ oauth: new FileOAuthStore(dir) })),
			],
		});
		boot(interp);
		try {
			expect(str((await runAsync(interp, '(login "linear")')).value)).toBe(
				":logged-in",
			);
			expect(str((await runAsync(interp, '(logout "linear")')).value)).toBe(
				":logged-out",
			);
			expect(
				await new FileOAuthStore(dir).load("https://mcp.linear.app"),
			).toBeUndefined();
		} finally {
			await runAsync(interp, "(mcp-shutdown)");
		}
	});

	it("writes token files with owner-only permissions", async () => {
		const dir = tmpDir();
		const store = new FileOAuthStore(dir);
		await store.save("https://mcp.example.com", {
			tokens: { access_token: "at", token_type: "Bearer" },
		});
		const files = readdirSync(dir);
		expect(statSync(join(dir, files[0])).mode & 0o777).toBe(0o600);
	});
});

describe("finishing a login from the browser callback", () => {
	it("refuses a callback whose state no login issued, and one with no code", async () => {
		const store = new FileOAuthStore(tmpDir());
		await store.save("ws/https://mcp.example.com", {
			codeVerifier: "v",
			pending: { state: "issued", serverUrl: "https://mcp.example.com/mcp" },
		});
		await expect(
			finishAuthorization(
				store,
				"ws/https://mcp.example.com",
				"https://app.example/oauth/callback?code=abc&state=forged",
			),
		).rejects.toThrow(/no authorization is waiting/);
		await expect(
			finishAuthorization(
				store,
				"ws/https://mcp.example.com",
				"https://app.example/oauth/callback?state=issued",
			),
		).rejects.toThrow(/no authorization code/);
	});
});

describe("CallbackServer (loopback)", () => {
	it("captures the code from a same-machine redirect and returns it", async () => {
		const cb = await CallbackServer.start({ host: "127.0.0.1" });
		try {
			const url = cb.redirectUrl();
			expect(url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/callback$/);
			const waiting = cb.waitForCode("st4te");
			await fetch(`${url}?code=the-code&state=st4te`);
			expect(await waiting).toBe("the-code");
		} finally {
			await cb.close();
		}
	});

	it("ignores a callback for an unknown state without disturbing a pending flow", async () => {
		const cb = await CallbackServer.start({ host: "127.0.0.1" });
		try {
			const waiting = cb.waitForCode("expected", 200);
			const res = await fetch(`${cb.redirectUrl()}?code=x&state=wrong`);
			expect(res.status).toBe(400);
			await fetch(`${cb.redirectUrl()}?code=the-code&state=expected`);
			expect(await waiting).toBe("the-code");
		} finally {
			await cb.close();
		}
	});

	it("routes concurrent flows to their own state", async () => {
		const cb = await CallbackServer.start({ host: "127.0.0.1" });
		try {
			const a = cb.waitForCode("aaa");
			const b = cb.waitForCode("bbb");
			await fetch(`${cb.redirectUrl()}?code=code-b&state=bbb`);
			await fetch(`${cb.redirectUrl()}?code=code-a&state=aaa`);
			expect(await a).toBe("code-a");
			expect(await b).toBe("code-b");
		} finally {
			await cb.close();
		}
	});

	it("reflects the exchange outcome in the browser page and the wait", async () => {
		const cb = await CallbackServer.start({ host: "127.0.0.1" });
		try {
			const failing = expect(
				cb.waitForCode("bad", undefined, async () => {
					throw new Error("PKCE mismatch");
				}),
			).rejects.toThrow(/PKCE mismatch/);
			const res = await fetch(`${cb.redirectUrl()}?code=c&state=bad`);
			expect(res.status).toBe(400);
			expect(await res.text()).toMatch(/PKCE mismatch/);
			await failing;

			const ok = cb.waitForCode("good", undefined, async () => {});
			const okRes = await fetch(`${cb.redirectUrl()}?code=c2&state=good`);
			expect(okRes.status).toBe(200);
			expect(await ok).toBe("c2");
		} finally {
			await cb.close();
		}
	});

	it("surfaces an OAuth error redirect instead of hanging", async () => {
		const cb = await CallbackServer.start({ host: "127.0.0.1" });
		try {
			const waiting = expect(cb.waitForCode("st")).rejects.toThrow(
				/access_denied/,
			);
			const res = await fetch(
				`${cb.redirectUrl()}?error=access_denied&state=st`,
			);
			expect(res.status).toBe(400);
			expect(await res.text()).toMatch(/access_denied/);
			await waiting;
		} finally {
			await cb.close();
		}
	});
});

describe("CallbackServer (ingress)", () => {
	it("binds 0.0.0.0, advertises the public URL, and captures via that path", async () => {
		const cb = await CallbackServer.start({
			host: "0.0.0.0",
			port: 8918,
			path: "/oauth/callback",
			redirectUrl: "https://mcp.example.com/oauth/callback",
		});
		try {
			expect(cb.redirectUrl()).toBe("https://mcp.example.com/oauth/callback");
			const waiting = cb.waitForCode("s");
			await fetch(`http://127.0.0.1:8918/oauth/callback?code=ingress&state=s`);
			expect(await waiting).toBe("ingress");
		} finally {
			await cb.close();
		}
	});
});

const lanAddress = Object.values(networkInterfaces())
	.flat()
	.find((a) => a?.family === "IPv4" && !a.internal)?.address;

describe("createAuthCallback", () => {
	it.skipIf(!lanAddress)(
		"takes the callback on an address beyond loopback behind an ingress",
		async () => {
			const cb = await createAuthCallback(
				8921,
				"https://mcp.example.com/oauth/callback",
			);
			try {
				const waiting = cb.waitForCode("s");
				await fetch(
					`http://${lanAddress}:8921/oauth/callback?code=lan&state=s`,
				);
				expect(await waiting).toBe("lan");
			} finally {
				await cb.close();
			}
		},
	);
});

describe("sharedAuthCallback", () => {
	it("lets a second caller on a fixed port reach the flows the first one is holding", async () => {
		const redirect = "http://127.0.0.1:8921/callback";
		const first = await sharedAuthCallback(8921, redirect);
		const waiting = first.waitForCode("early");
		const second = await sharedAuthCallback(8921, redirect);
		try {
			const late = second.waitForCode("late-arrival");
			await fetch(`${redirect}?code=captured&state=late-arrival`);
			await fetch(`${redirect}?code=kept&state=early`);
			expect(await late).toBe("captured");
			expect(await waiting).toBe("kept");
		} finally {
			await first.close();
		}
	});

	it("keeps the bound server, and its pending flows, across a module reload", async () => {
		const redirect = "http://127.0.0.1:8923/callback";
		const before = await sharedAuthCallback(8923, redirect);
		const waiting = before.waitForCode("survives-reload");
		vi.resetModules();
		const reloaded = await import("../src/mcp-oauth.ts");
		try {
			await reloaded.sharedAuthCallback(8923, redirect);
			await fetch(`${redirect}?code=still-here&state=survives-reload`);
			expect(await waiting).toBe("still-here");
		} finally {
			await before.close();
		}
	});
});
