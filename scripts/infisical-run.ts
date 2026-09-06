import { spawn } from "node:child_process";
import { InfisicalSDK } from "@infisical/sdk";
import { command, oneOf, option, positional, run, string } from "cmd-ts";

const FORWARDED_SIGNALS: NodeJS.Signals[] = ["SIGINT", "SIGTERM", "SIGQUIT"];
const FORWARD_AFTER_MS = 5000;
const KILL_AFTER_MS = 10000;

function spawnWithSignal(
	cmd: string,
	options: { cwd: string; env: NodeJS.ProcessEnv },
): Promise<number> {
	return new Promise((resolve, reject) => {
		const child = spawn(cmd, {
			...options,
			shell: true,
			stdio: "inherit",
		});

		let interrupted = false;
		const timers: NodeJS.Timeout[] = [];
		const signalTree = (sig: NodeJS.Signals) => {
			if (child.pid === undefined) return;
			try {
				process.kill(-child.pid, sig);
			} catch {
				child.kill(sig);
			}
		};
		const forward = (sig: NodeJS.Signals) => () => {
			if (interrupted) return;
			interrupted = true;
			timers.push(
				setTimeout(() => signalTree(sig), FORWARD_AFTER_MS).unref(),
				setTimeout(() => signalTree("SIGKILL"), KILL_AFTER_MS).unref(),
			);
		};
		const handlers = FORWARDED_SIGNALS.map(
			(sig) => [sig, forward(sig)] as const,
		);
		for (const [sig, handler] of handlers) process.on(sig, handler);
		const cleanup = () => {
			for (const timer of timers) clearTimeout(timer);
			for (const [sig, handler] of handlers) process.off(sig, handler);
		};

		child.on("error", (err) => {
			cleanup();
			reject(err);
		});
		child.on("close", (code) => {
			cleanup();
			resolve(interrupted ? 0 : (code ?? 0));
		});
	});
}

const infisicalRun = command({
	name: "infisical-run",
	args: {
		projectId: option({
			type: string,
			long: "projectId",
			description: "Infisical project identifier containing the secrets",
		}),
		url: option({
			type: string,
			long: "url",
			description: "Base URL of the Infisical instance",
			defaultValue: () => "https://app.infisical.com",
		}),
		env: option({
			type: oneOf(["dev", "stage", "prod"]),
			long: "env",
			short: "e",
			description: "Infisical environment to load secrets from",
			defaultValue: () => "dev",
		}),
		paths: option({
			type: string,
			long: "paths",
			description: "Space-separated list of secret paths to fetch",
			defaultValue: () => "/",
		}),
		dir: option({
			type: string,
			long: "dir",
			description: "Working directory to run the command in",
			defaultValue: () => ".",
		}),
		cmd: positional({
			type: string,
			displayName: "cmd",
			description: "Command to execute with injected secrets",
		}),
	},
	handler: async ({ url, env, projectId, paths, dir, cmd }) => {
		const processedPaths = paths.split(" ").filter((path) => path !== "");

		const clientId = process.env.INFISICAL_CLIENT_ID;
		const clientSecret = process.env.INFISICAL_CLIENT_SECRET;

		if (!clientId) {
			throw new Error(
				"INFISICAL_CLIENT_ID is required to authenticate with Infisical.",
			);
		}

		if (!clientSecret) {
			throw new Error(
				"INFISICAL_CLIENT_SECRET is required to authenticate with Infisical.",
			);
		}

		const client = new InfisicalSDK({
			siteUrl: url,
		});

		try {
			await client.auth().universalAuth.login({
				clientId,
				clientSecret,
			});
		} catch (error) {
			const message =
				error instanceof Error
					? error.message
					: "Unknown error during Infisical authentication";
			throw new Error(`Infisical authentication failed: ${message}`);
		}

		console.info(`requesting secrets from ${processedPaths}`);
		const allPathsSecrets = await Promise.all(
			processedPaths.map((path) =>
				client.secrets().listSecrets({
					projectId,
					environment: env,
					secretPath: path,
				}),
			),
		);

		const secrets = allPathsSecrets.reduce<Record<string, string>>(
			(acc, pathSecrets) => {
				for (const secret of pathSecrets.secrets) {
					acc[secret.secretKey] = secret.secretValue;
				}
				return acc;
			},
			{},
		);
		console.info(`${Object.keys(secrets).length} secrets loaded 👌`);
		const exitCode = await spawnWithSignal(cmd, {
			env: { ...process.env, ...secrets },
			cwd: dir,
		});
		process.exit(exitCode);
	},
});

run(infisicalRun, process.argv.slice(2));
