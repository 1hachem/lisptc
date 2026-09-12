import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const R2_VARS = [
	"R2_ACCOUNT_ID",
	"R2_ACCESS_KEY_ID",
	"R2_SECRET_ACCESS_KEY",
	"R2_BUCKET",
	"R2_ENDPOINT",
	"R2_EVALS_PREFIX",
	"EVAL_STORAGE",
	"EVAL_REPORT_DIR",
];

let dir: string;

function envFor(env: Record<string, string>): void {
	for (const name of R2_VARS) delete process.env[name];
	process.env.EVAL_REPORT_DIR = dir;
	Object.assign(process.env, env);
	vi.resetModules();
}

async function storage(env: Record<string, string>) {
	envFor(env);
	return await import("../src/storage.ts");
}

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "evals-storage-"));
});

afterEach(() => {
	rmSync(dir, { recursive: true, force: true });
	for (const name of R2_VARS) delete process.env[name];
});

describe("the report store", () => {
	test("the filesystem store round-trips a report", async () => {
		const { localStore } = await storage({});
		const store = localStore(dir);

		await store.write("2026-01-01__stub.json", '{"ok":true}\n');

		expect(await store.list()).toMatchObject([
			{ name: "2026-01-01__stub.json" },
		]);
		expect(await store.read("2026-01-01__stub.json")).toBe('{"ok":true}\n');
		expect(readFileSync(join(dir, "2026-01-01__stub.json"), "utf8")).toContain(
			"ok",
		);
	});

	test("listing a directory that was never written is empty, not an error", async () => {
		const { localStore } = await storage({});
		expect(await localStore(join(dir, "nothing")).list()).toEqual([]);
	});

	test("no credentials falls back to the filesystem", async () => {
		const { reportStore } = await storage({});
		expect(reportStore().describe()).toBe(`${dir}/`);
	});

	test("credentials make R2 the default, under the prefix", async () => {
		const { reportStore } = await storage({
			R2_ACCOUNT_ID: "acct",
			R2_ACCESS_KEY_ID: "key",
			R2_SECRET_ACCESS_KEY: "secret",
			R2_BUCKET: "lisptc",
			R2_EVALS_PREFIX: "/reports",
		});
		expect(reportStore().describe()).toBe("r2://lisptc/reports/");
	});

	test("EVAL_STORAGE=local wins over credentials", async () => {
		const { reportStore } = await storage({
			R2_ACCOUNT_ID: "acct",
			R2_ACCESS_KEY_ID: "key",
			R2_SECRET_ACCESS_KEY: "secret",
			R2_BUCKET: "lisptc",
			EVAL_STORAGE: "local",
		});
		expect(reportStore().describe()).toBe(`${dir}/`);
	});

	test("EVAL_STORAGE=r2 without credentials is an error, not a silent local write", async () => {
		const { reportStore } = await storage({ EVAL_STORAGE: "r2" });
		expect(() => reportStore()).toThrow(/no R2 credentials/);
	});

	test("the merged report goes to the store, and the shards do not", async () => {
		envFor({});
		const { shardPath } = await import("../src/shards.ts");
		const { setup, teardown } = await import("../src/global-setup.ts");
		const { reportStore } = await import("../src/storage.ts");
		setup();
		writeFileSync(
			shardPath("2026-01-01T00-00-00-1"),
			JSON.stringify({
				startedAt: "2026-01-01T00-00-00",
				sha: "",
				targets: [{ provider: "digitalocean", model: "stub" }],
				cases: [],
				rows: [],
			}),
		);

		await teardown();

		expect(await reportStore().list()).toEqual([
			{
				name: "2026-01-01T00-00-00__digitalocean-stub.json",
				modifiedAt: expect.any(Number),
			},
		]);
	});

	test("half-configured credentials name what is missing", async () => {
		const { reportStore } = await storage({
			R2_ACCOUNT_ID: "acct",
			R2_BUCKET: "lisptc",
		});
		expect(() => reportStore()).toThrow(
			/R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY/,
		);
	});
});
