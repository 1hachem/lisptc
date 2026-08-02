import { mkdtempSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	createAuthCallback,
	ExternalAuthCallback,
	FileOAuthStore,
	LoopbackAuthCallback,
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

describe("AuthCallback (loopback)", () => {
	it("captures the code from a same-machine redirect and returns it", async () => {
		const cb = await LoopbackAuthCallback.start();
		try {
			const url = cb.redirectUrl();
			expect(url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/callback$/);
			const waiting = cb.waitForCode("st4te");
			// Simulate the browser hitting the loopback redirect.
			await fetch(`${url}?code=the-code&state=st4te`);
			expect(await waiting).toBe("the-code");
		} finally {
			await cb.close();
		}
	});

	it("rejects on a state mismatch", async () => {
		const cb = await LoopbackAuthCallback.start();
		try {
			// Attach the rejection handler before triggering the callback.
			const assertion = expect(cb.waitForCode("expected")).rejects.toThrow(
				/state mismatch/,
			);
			await fetch(`${cb.redirectUrl()}?code=x&state=wrong`);
			await assertion;
		} finally {
			await cb.close();
		}
	});

	it("binds a fixed port and rejects a second bind on it", async () => {
		const first = await LoopbackAuthCallback.start("/callback", 8917);
		try {
			expect(first.redirectUrl()).toBe("http://127.0.0.1:8917/callback");
			await expect(
				LoopbackAuthCallback.start("/callback", 8917),
			).rejects.toMatchObject({ code: "EADDRINUSE" });
		} finally {
			await first.close();
		}
	});

	it("times out if the code never arrives", async () => {
		const cb = await LoopbackAuthCallback.start();
		try {
			await expect(cb.waitForCode("s", 20)).rejects.toThrow(/timed out/);
		} finally {
			await cb.close();
		}
	});
});

describe("AuthCallback (external / ingress)", () => {
	it("registers the configured public redirect and resolves via submitCode", async () => {
		const cb = new ExternalAuthCallback(
			"https://mcp.example.com/oauth/callback",
		);
		expect(cb.redirectUrl()).toBe("https://mcp.example.com/oauth/callback");
		const waiting = cb.waitForCode("state-1");
		// An ingress handler (or (mcp-authorize)) delivers the code out-of-band.
		cb.submitCode({ code: "ingress-code", state: "state-1" });
		expect(await waiting).toBe("ingress-code");
	});
});

describe("createAuthCallback", () => {
	it("uses the ingress redirect URL when LISPTC_OAUTH_REDIRECT_URL is set", async () => {
		const prev = process.env.LISPTC_OAUTH_REDIRECT_URL;
		process.env.LISPTC_OAUTH_REDIRECT_URL =
			"https://mcp.example.com/oauth/callback";
		try {
			const cb = await createAuthCallback();
			expect(cb).toBeInstanceOf(ExternalAuthCallback);
			expect(cb.redirectUrl()).toBe("https://mcp.example.com/oauth/callback");
			await cb.close();
		} finally {
			if (prev === undefined) delete process.env.LISPTC_OAUTH_REDIRECT_URL;
			else process.env.LISPTC_OAUTH_REDIRECT_URL = prev;
		}
	});

	it("falls back to a loopback server for local use", async () => {
		const prev = process.env.LISPTC_OAUTH_REDIRECT_URL;
		delete process.env.LISPTC_OAUTH_REDIRECT_URL;
		try {
			const cb = await createAuthCallback();
			expect(cb).toBeInstanceOf(LoopbackAuthCallback);
			expect(cb.redirectUrl()).toMatch(/^http:\/\/127\.0\.0\.1:\d+/);
			await cb.close();
		} finally {
			if (prev !== undefined) process.env.LISPTC_OAUTH_REDIRECT_URL = prev;
		}
	});
});
