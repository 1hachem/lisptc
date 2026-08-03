import { mkdtempSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	CallbackServer,
	createAuthCallback,
	FileOAuthStore,
	type OAuthRecord,
	type OAuthStore,
	StoredOAuthProvider,
} from "../src/mcp-oauth.ts";

const REDIRECT = "http://127.0.0.1:8991/callback";

function tmpDir(): string {
	return mkdtempSync(join(tmpdir(), "lisptc-oauth-"));
}

describe("FileOAuthStore", () => {
	it("round-trips a record and clears it", async () => {
		const store = new FileOAuthStore(tmpDir());
		expect(await store.load("https://mcp.example.com")).toBeUndefined();

		const rec: OAuthRecord = {
			tokens: { access_token: "at", token_type: "Bearer", refresh_token: "rt" },
			codeVerifier: "v",
		};
		await store.save("https://mcp.example.com", rec);
		expect(await store.load("https://mcp.example.com")).toEqual(rec);

		await store.clear("https://mcp.example.com");
		expect(await store.load("https://mcp.example.com")).toBeUndefined();
	});

	it("writes token files with owner-only permissions", async () => {
		const dir = tmpDir();
		const store = new FileOAuthStore(dir);
		await store.save("https://mcp.example.com", {
			tokens: { access_token: "at", token_type: "Bearer" },
		});
		// One 0600 file was created under the store dir.
		const { readdirSync } = await import("node:fs");
		const files = readdirSync(dir);
		expect(files).toHaveLength(1);
		expect(statSync(join(dir, files[0])).mode & 0o777).toBe(0o600);
	});
});

describe("StoredOAuthProvider", () => {
	// An in-memory OAuthStore, proving the interface is the seam a DB store would
	// implement.
	function memoryStore(): OAuthStore & { data: Map<string, OAuthRecord> } {
		const data = new Map<string, OAuthRecord>();
		return {
			data,
			async load(k) {
				return data.get(k);
			},
			async save(k, r) {
				data.set(k, structuredClone(r));
			},
			async clear(k) {
				data.delete(k);
			},
		};
	}

	it("hydrates existing tokens so a later session reuses them", async () => {
		const store = memoryStore();
		store.data.set("https://mcp.example.com", {
			tokens: { access_token: "cached", token_type: "Bearer" },
		});
		const p = await StoredOAuthProvider.create(
			store,
			"https://mcp.example.com/mcp",
			REDIRECT,
		);
		expect(p.tokens()?.access_token).toBe("cached");
		// Keyed by origin, so the /mcp path does not matter.
		expect(p.redirectUrl).toBe(REDIRECT);
		expect(p.clientMetadata.redirect_uris).toEqual([REDIRECT]);
	});

	it("write-throughs tokens, client info and verifier to the store", async () => {
		const store = memoryStore();
		const p = await StoredOAuthProvider.create(
			store,
			"https://mcp.example.com/mcp",
			REDIRECT,
		);
		await p.saveClientInformation({
			client_id: "cid",
			redirect_uris: [REDIRECT],
		});
		await p.saveCodeVerifier("verifier-123");
		await p.saveTokens({
			access_token: "at",
			token_type: "Bearer",
			refresh_token: "rt",
		});

		const rec = store.data.get("https://mcp.example.com");
		expect(rec?.clientInformation?.client_id).toBe("cid");
		expect(rec?.codeVerifier).toBe("verifier-123");
		expect(rec?.tokens?.refresh_token).toBe("rt");
		expect(p.codeVerifier()).toBe("verifier-123");
	});

	it("captures the authorization URL instead of opening it", async () => {
		const p = await StoredOAuthProvider.create(
			memoryStore(),
			"https://mcp.example.com/mcp",
			REDIRECT,
		);
		expect(p.authorizationUrl).toBeUndefined();
		const url = new URL("https://auth.example.com/authorize?client_id=cid");
		p.redirectToAuthorization(url);
		expect(p.authorizationUrl?.href).toBe(url.href);
	});

	it("throws if a code verifier is requested before one is saved", async () => {
		const p = await StoredOAuthProvider.create(
			memoryStore(),
			"https://mcp.example.com/mcp",
			REDIRECT,
		);
		expect(() => p.codeVerifier()).toThrow(/code verifier/);
	});

	it("invalidateCredentials clears the selected scope", async () => {
		const store = memoryStore();
		const p = await StoredOAuthProvider.create(
			store,
			"https://mcp.example.com/mcp",
			REDIRECT,
		);
		await p.saveTokens({ access_token: "at", token_type: "Bearer" });
		await p.saveClientInformation({
			client_id: "cid",
			redirect_uris: [REDIRECT],
		});
		await p.invalidateCredentials("tokens");
		expect(p.tokens()).toBeUndefined();
		expect(p.clientInformation()?.client_id).toBe("cid"); // client kept
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
			// A stray callback for a different state must not resolve/reject ours.
			const res = await fetch(`${cb.redirectUrl()}?code=x&state=wrong`);
			expect(res.status).toBe(400);
			expect(await res.text()).toMatch(/unknown or has expired/);
			// The right callback still completes the pending flow.
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
			// A failing exchange yields an error page and a rejected wait, never a
			// misleading "complete" page.
			const failing = expect(
				cb.waitForCode("bad", undefined, async () => {
					throw new Error("PKCE mismatch");
				}),
			).rejects.toThrow(/PKCE mismatch/);
			const res = await fetch(`${cb.redirectUrl()}?code=c&state=bad`);
			expect(res.status).toBe(400);
			expect(await res.text()).toMatch(/PKCE mismatch/);
			await failing;

			// A succeeding exchange runs before the success page is shown.
			let exchanged = "";
			const ok = cb.waitForCode("good", undefined, async (code) => {
				exchanged = code;
			});
			const okRes = await fetch(`${cb.redirectUrl()}?code=c2&state=good`);
			expect(okRes.status).toBe(200);
			expect(await okRes.text()).toMatch(/Authorization complete/);
			expect(await ok).toBe("c2");
			expect(exchanged).toBe("c2");
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

	it("binds a fixed port and rejects a second bind on it", async () => {
		const first = await CallbackServer.start({ host: "127.0.0.1", port: 8917 });
		try {
			expect(first.redirectUrl()).toBe("http://127.0.0.1:8917/callback");
			await expect(
				CallbackServer.start({ host: "127.0.0.1", port: 8917 }),
			).rejects.toMatchObject({ code: "EADDRINUSE" });
		} finally {
			await first.close();
		}
	});

	it("times out if the code never arrives", async () => {
		const cb = await CallbackServer.start({ host: "127.0.0.1" });
		try {
			await expect(cb.waitForCode("s", 20)).rejects.toThrow(/timed out/);
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
			// The auth server sees the public domain URL...
			expect(cb.redirectUrl()).toBe("https://mcp.example.com/oauth/callback");
			// ...while the ingress reaches the pod on 0.0.0.0:port at the same path.
			const waiting = cb.waitForCode("s");
			await fetch(`http://127.0.0.1:8918/oauth/callback?code=ingress&state=s`);
			expect(await waiting).toBe("ingress");
		} finally {
			await cb.close();
		}
	});
});

describe("createAuthCallback", () => {
	it("binds 0.0.0.0 and advertises a given ingress URL", async () => {
		const cb = await createAuthCallback(
			8919,
			"https://mcp.example.com/oauth/callback",
		);
		try {
			expect(cb).toBeInstanceOf(CallbackServer);
			expect(cb.redirectUrl()).toBe("https://mcp.example.com/oauth/callback");
		} finally {
			await cb.close();
		}
	});

	it("binds a local loopback server when no ingress URL is given", async () => {
		const cb = await createAuthCallback(8920);
		try {
			expect(cb).toBeInstanceOf(CallbackServer);
			expect(cb.redirectUrl()).toBe("http://127.0.0.1:8920/callback");
		} finally {
			await cb.close();
		}
	});
});
