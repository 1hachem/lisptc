import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { adoptPath, desktopEnv } from "@repo/env/desktop";

const exec = promisify(execFile);

const SHELL_TIMEOUT_MS = 5_000;

function pathFromEnvDump(dump: string): string | undefined {
	return dump
		.split("\n")
		.filter((line) => line.startsWith("PATH="))
		.at(-1)
		?.slice("PATH=".length);
}

async function adopt(): Promise<void> {
	if (process.platform === "win32") return;
	const shell =
		desktopEnv.SHELL ??
		(process.platform === "darwin" ? "/bin/zsh" : "/bin/sh");
	const dump = await exec(shell, ["-ilc", "/usr/bin/env"], {
		timeout: SHELL_TIMEOUT_MS,
	}).catch(() => undefined);
	const path = dump === undefined ? undefined : pathFromEnvDump(dump.stdout);
	if (path) adoptPath(path);
}

let adopting: Promise<void> | undefined;

export function loginPathAdopted(): Promise<void> {
	adopting ??= adopt();
	return adopting;
}
