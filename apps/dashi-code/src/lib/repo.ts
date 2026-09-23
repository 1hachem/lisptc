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

export async function exec(
	command: string,
	args: string[],
): Promise<{ stdout: string; stderr: string }> {
	try {
		return await run(command, args, { cwd: repoRoot(), maxBuffer: MAX_OUTPUT });
	} catch (err) {
		const held = err as { stdout?: string; stderr?: string };
		if (typeof held.stdout === "string" && held.stdout.includes("{"))
			return { stdout: held.stdout, stderr: held.stderr ?? "" };
		throw err;
	}
}
