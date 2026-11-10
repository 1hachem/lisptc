import {
	getDefaultEnvironment,
	StdioClientTransport,
} from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { DockerRunner } from "@repo/containers/docker";
import type {
	CommandServer,
	ImageServer,
	LocalServerSpec,
} from "@repo/desktop-protocol";
import { localServerEnv } from "@repo/env/desktop";
import type { Opener } from "./local-server.ts";
import { loginPathAdopted } from "./login-path.ts";

function commandOpener(spec: CommandServer): Opener {
	return async () => {
		await loginPathAdopted();
		return {
			transport: new StdioClientTransport({
				command: spec.command,
				args: [...spec.args],
				env: { ...getDefaultEnvironment(), ...localServerEnv, ...spec.env },
				stderr: "inherit",
			}),
			release: async () => {},
		};
	};
}

function imageOpener(spec: ImageServer, runner: DockerRunner): Opener {
	return async (exited) => {
		await loginPathAdopted();
		const container = await runner.run(spec, exited);
		return {
			transport: new StreamableHTTPClientTransport(new URL(container.url)),
			release: () => container.stop(),
		};
	};
}

export function openerFor(spec: LocalServerSpec, runner: DockerRunner): Opener {
	return spec.kind === "command"
		? commandOpener(spec)
		: imageOpener(spec, runner);
}
