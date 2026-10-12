import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const SCRIPT = join(import.meta.dirname, "../../scripts/migrate.sh");

type Status = {
	name: string;
	state: "inProgress" | "success" | "failed" | "canceled" | "unknown";
	isDone: boolean;
	processed: number;
	error?: string;
};

const NAME = "migrations:resetRetiredModels";

const status = (over: Partial<Status>): Status => ({
	name: NAME,
	state: "inProgress",
	isDone: false,
	processed: 0,
	...over,
});

const dirs: string[] = [];

afterEach(() => {
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true });
});

function run(
	answers: string[],
	options: { timeout?: number; startFails?: boolean } = {},
) {
	const dir = mkdtempSync(join(tmpdir(), "migrate-"));
	dirs.push(dir);
	answers.forEach((answer, i) => {
		writeFileSync(join(dir, `status-${i}`), answer);
	});
	const pnpm = join(dir, "pnpm");
	writeFileSync(
		pnpm,
		`#!/bin/sh
echo "$*" >> "${dir}/calls"
case "$*" in
  "exec convex run migrations:runLive") ${options.startFails ? "exit 1" : "echo '{}'"} ;;
  "exec convex run migrations:liveStatus")
    n=$(cat "${dir}/count" 2>/dev/null || echo 0)
    last=$(ls "${dir}" | grep -c '^status-')
    [ "$n" -ge "$last" ] && n=$((last - 1))
    cat "${dir}/status-$n"
    echo $((n + 1)) > "${dir}/count" ;;
  *) exit 2 ;;
esac
`,
	);
	chmodSync(pnpm, 0o755);
	const result = spawnSync("sh", [SCRIPT], {
		encoding: "utf8",
		env: {
			PATH: `${dir}:${process.env.PATH}`,
			MIGRATION_POLL_SECONDS: "0",
			MIGRATION_TIMEOUT_SECONDS: String(options.timeout ?? 60),
		},
	});
	return { code: result.status, out: result.stdout, err: result.stderr };
}

const json = (statuses: Status[]) => JSON.stringify(statuses);

describe("the migrate script a release runs", () => {
	it("waits while a migration is in progress and passes once it is done", () => {
		const result = run([
			json([status({ processed: 100 })]),
			json([status({ processed: 200 })]),
			json([status({ state: "success", isDone: true, processed: 250 })]),
		]);
		expect(result.code).toBe(0);
		expect(result.out).toContain(`pending ${NAME} (100 processed)`);
		expect(result.out).toContain("migrations complete");
	});

	it("passes at once when every migration already ran", () => {
		const result = run([json([status({ state: "success", isDone: true })])]);
		expect(result.code).toBe(0);
		expect(result.out).not.toContain("pending");
	});

	it("waits on a migration the series has not reached yet", () => {
		const result = run([
			json([status({ state: "unknown" })]),
			json([status({ state: "success", isDone: true })]),
		]);
		expect(result.code).toBe(0);
		expect(result.out).toContain(`pending ${NAME}`);
	});

	it("fails the release on a failed migration, naming it and its error", () => {
		const result = run([
			json([status({ state: "failed", isDone: true, error: "boom" })]),
		]);
		expect(result.code).toBe(1);
		expect(result.err).toContain(`failed ${NAME}: failed boom`);
	});

	it("fails the release on a canceled migration", () => {
		const result = run([json([status({ state: "canceled", isDone: true })])]);
		expect(result.code).toBe(1);
		expect(result.err).toContain(`failed ${NAME}: canceled`);
	});

	it("fails the release when the status cannot be read", () => {
		const result = run(["not json"]);
		expect(result.code).not.toBe(0);
		expect(result.out).not.toContain("migrations complete");
	});

	it("fails the release when the migrations cannot be started", () => {
		const result = run([json([status({ state: "success", isDone: true })])], {
			startFails: true,
		});
		expect(result.code).not.toBe(0);
		expect(result.out).not.toContain("migrations complete");
	});

	it("fails the release once the migrations outlast the timeout", () => {
		const result = run([json([status({ processed: 100 })])], { timeout: 0 });
		expect(result.code).toBe(1);
		expect(result.err).toContain(
			`migrations still running after 0s: ${NAME} (100 processed)`,
		);
	});
});
