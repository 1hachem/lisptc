import { spawn } from "node:child_process";
import { InfisicalSDK } from "@infisical/sdk";
import { command, oneOf, option, positional, run, string } from "cmd-ts";

// Helper to run a command with inherited stdio for interactive support
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

		child.on("error", reject);
		child.on("close", (code) => resolve(code ?? 0));

		// forward termination signals to the child process
		const forward = (sig: NodeJS.Signals) => {
			if (!child.killed) {
				child.kill(sig);
			}
		};

		process.on("SIGINT", () => forward("SIGINT"));
		process.on("SIGTERM", () => forward("SIGTERM"));
		process.on("SIGQUIT", () => forward("SIGQUIT"));
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
	handler: async ({ env, projectId, paths, dir, cmd }) => {
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

		const client = new InfisicalSDK();

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
		// Execute the provided command with inherited stdio for interactive support
		const exitCode = await spawnWithSignal(cmd, {
			env: { ...process.env, ...secrets },
			cwd: dir,
		});
		process.exit(exitCode);
	},
});

run(infisicalRun, process.argv.slice(2));
