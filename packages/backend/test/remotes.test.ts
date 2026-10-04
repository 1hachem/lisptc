import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../convex/_generated/api.js";
import { unseal } from "../convex/lib/seal.ts";
import { harness, signIn } from "./helpers.ts";

const KEY = btoa(String.fromCharCode(...new Uint8Array(32).fill(7)));
const URL_OK = "https://git.example.com/alice/notes.git";

function gitServer(access: { read: number; write: number }) {
	return vi.fn(async (input: string | URL) => {
		const url = String(input);
		if (!url.startsWith(URL_OK)) return new Response(null, { status: 404 });
		const status = url.endsWith("git-receive-pack")
			? access.write
			: access.read;
		return new Response(null, { status });
	});
}

beforeEach(() => {
	process.env.GIT_CREDENTIAL_KEY = KEY;
});

afterEach(() => {
	vi.unstubAllGlobals();
	delete process.env.GIT_CREDENTIAL_KEY;
	delete process.env.HOSTED_GIT_URL;
});

describe("connecting a git remote", () => {
	it("keeps a credential that can push, sealed, and never shows it", async () => {
		vi.stubGlobal("fetch", gitServer({ read: 200, write: 200 }));
		const t = harness();
		const alice = await signIn(t, "alice@example.com");
		expect(
			await alice.as.action(api.remotes.connect, {
				workspaceId: alice.workspace,
				url: URL_OK,
				token: "ghp_secret",
			}),
		).toEqual({});

		const view = await alice.as.query(api.remotes.get, {
			workspaceId: alice.workspace,
		});
		expect(view).toMatchObject({ kind: "own", url: URL_OK });
		expect(JSON.stringify(view)).not.toContain("ghp_secret");

		const row = await t.run(async (ctx) => ctx.db.query("remotes").first());
		expect(row?.credential).not.toContain("ghp_secret");
		expect(await unseal(KEY, row?.credential ?? "")).toBe("ghp_secret");
	});

	it("sends the credential as basic auth to the remote", async () => {
		const server = gitServer({ read: 200, write: 200 });
		vi.stubGlobal("fetch", server);
		const t = harness();
		const alice = await signIn(t, "alice@example.com");
		await alice.as.action(api.remotes.connect, {
			workspaceId: alice.workspace,
			url: URL_OK,
			username: "alice",
			token: "tok",
		});
		const [, init] = server.mock.calls[0] as unknown as [string, RequestInit];
		expect(new Headers(init.headers).get("authorization")).toBe(
			`Basic ${btoa("alice:tok")}`,
		);
	});

	it.each([
		[{ read: 200, write: 403 }, "READ_ONLY"],
		[{ read: 401, write: 401 }, "NO_ACCESS"],
		[{ read: 404, write: 404 }, "NOT_FOUND"],
		[{ read: 500, write: 500 }, "UNREACHABLE"],
	])("refuses %o as %s and saves nothing", async (access, problem) => {
		vi.stubGlobal("fetch", gitServer(access));
		const t = harness();
		const alice = await signIn(t, "alice@example.com");
		expect(
			await alice.as.action(api.remotes.connect, {
				workspaceId: alice.workspace,
				url: URL_OK,
				token: "tok",
			}),
		).toEqual({ problem });
		expect(
			await alice.as.query(api.remotes.get, { workspaceId: alice.workspace }),
		).toBeNull();
	});

	it.each([
		"http://git.example.com/alice/notes.git",
		"https://user:pw@git.example.com/alice/notes.git",
		"not a url",
	])("refuses %s before reaching the network", async (url) => {
		const server = gitServer({ read: 200, write: 200 });
		vi.stubGlobal("fetch", server);
		const t = harness();
		const alice = await signIn(t, "alice@example.com");
		expect(
			await alice.as.action(api.remotes.connect, {
				workspaceId: alice.workspace,
				url,
				token: "tok",
			}),
		).toEqual({ problem: "BAD_URL" });
		expect(server).not.toHaveBeenCalled();
	});

	it("refuses to store a credential with no key configured", async () => {
		delete process.env.GIT_CREDENTIAL_KEY;
		vi.stubGlobal("fetch", gitServer({ read: 200, write: 200 }));
		const t = harness();
		const alice = await signIn(t, "alice@example.com");
		await expect(
			alice.as.action(api.remotes.connect, {
				workspaceId: alice.workspace,
				url: URL_OK,
				token: "tok",
			}),
		).rejects.toThrow(/GIT_CREDENTIALS_UNCONFIGURED/);
	});

	it("records a skipped remote", async () => {
		const t = harness();
		const alice = await signIn(t, "alice@example.com");
		await alice.as.mutation(api.remotes.skip, { workspaceId: alice.workspace });
		expect(
			await alice.as.query(api.remotes.get, { workspaceId: alice.workspace }),
		).toEqual({ kind: "none" });
	});

	it("says the hosted remote is unavailable when the deployment has none", async () => {
		const t = harness();
		const alice = await signIn(t, "alice@example.com");
		await expect(
			alice.as.action(api.remotes.host, { workspaceId: alice.workspace }),
		).rejects.toThrow(/HOSTED_GIT_UNAVAILABLE/);
	});
});
