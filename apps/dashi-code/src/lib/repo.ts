import { execFile } from "node:child_process";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { dashiCodesEnv } from "@repo/env/dashi-codes";

const run = promisify(execFile);

const MAX_OUTPUT = 128 * 1024 * 1024;

export function repoRoot(): string {
	return resolve(process.cwd(), dashiCodesEnv.DASHI_CODES_REPO ?? "../..");
}

export async function git(args: string[]): Promise<string> {
	const { stdout } = await run("git", args, {
		cwd: repoRoot(),
		maxBuffer: MAX_OUTPUT,
	});
	return stdout;
}

function reportedFailure(stdout: string | undefined): string | null {
	if (typeof stdout !== "string") return null;
	const brace = stdout.indexOf("{");
	if (brace < 0) return null;
	let parsed: unknown;
	try {
		parsed = JSON.parse(stdout.slice(brace));
	} catch {
		return null;
	}
	const held = parsed as { error?: unknown; message?: unknown } | null;
	if (held?.error !== true) return null;
	return typeof held.message === "string"
		? held.message
		: "the command reported an error";
}

export async function exec(
	command: string,
	args: string[],
): Promise<{ stdout: string; stderr: string }> {
	try {
		return await run(command, args, { cwd: repoRoot(), maxBuffer: MAX_OUTPUT });
	} catch (err) {
		const held = err as { stdout?: string; stderr?: string };
		const failure = reportedFailure(held.stdout);
		if (failure !== null) throw new Error(failure);
		if (typeof held.stdout === "string" && held.stdout.includes("{"))
			return { stdout: held.stdout, stderr: held.stderr ?? "" };
		throw err;
	}
}
