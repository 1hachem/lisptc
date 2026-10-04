import { ASKS_KEY, type Asks } from "@repo/interpreter/asks";
import { bufferTransport } from "@repo/interpreter/channels-host";
import { StepHold } from "@repo/interpreter/errors";
import { Interp, runSync } from "@repo/interpreter/lisp";
import { prelude } from "@repo/interpreter/prelude";
import { noAnnotations, openSession } from "@repo/interpreter/session";
import { describe, expect, it } from "vitest";
import { mcpExtension } from "../src/mcp.ts";
import { mcpHost } from "../src/mcp-host.ts";
import { AuthorizationRequired, type McpClient } from "../src/ports.ts";

const AUTH_URL = "https://auth.example/authorize?state=s-123&client_id=c";

const loginClient: McpClient = {
	connect: (conf) =>
		Promise.reject(new AuthorizationRequired(conf.name, AUTH_URL, false)),
	callTool: () => Promise.resolve(null),
	disconnect: () => Promise.resolve(),
	login: () => Promise.resolve({ authUrl: AUTH_URL }),
	logout: () => Promise.resolve(),
	authorize: () => Promise.resolve(),
	shutdown: () => Promise.resolve(),
};

function session() {
	const extension = mcpExtension({ ...mcpHost, client: loginClient });
	const interp = new Interp({ extensions: [extension] });
	runSync(interp, prelude);
	return { interp, hooks: openSession([extension]) };
}

async function step(interp: Interp, run: () => Promise<unknown>) {
	const buffer = bufferTransport();
	const detach = interp.channels.pipe(buffer);
	try {
		return {
			buffer,
			thrown: await run().then(
				() => undefined,
				(e) => e,
			),
		};
	} finally {
		detach();
	}
}

function asksOf(
	hooks: ReturnType<typeof openSession>,
	buffer: ReturnType<typeof bufferTransport>,
): Asks {
	return hooks.annotate.run((_b, into) => into, buffer, noAnnotations()).output[
		ASKS_KEY
	] as Asks;
}

describe("a load that needs a login", () => {
	it("holds the step and asks the user to authorize at the link", async () => {
		const { interp, hooks } = session();
		const { buffer, thrown } = await step(
			interp,
			() =>
				runSync(
					interp,
					'(load-mcp :name "acme" :url "https://acme.example/mcp")',
				) as Promise<unknown>,
		);
		expect(thrown).toBeInstanceOf(StepHold);
		expect((thrown as StepHold).reason).toContain(AUTH_URL);
		const [ask] = asksOf(hooks, buffer).open ?? [];
		expect(ask?.id).toBe("s-123");
		expect(ask?.title).toBe("acme");
		expect(ask?.choices.find((c) => c.accepts)?.opens).toBe(AUTH_URL);
	});

	it("records the answer and tells the model to load the server again", async () => {
		const { interp, hooks } = session();
		const { buffer, thrown } = await step(interp, () =>
			hooks.invoke.run(() => Promise.reject(new Error("unhandled")), {
				interp,
				action: "mcp/authorize",
				values: { id: "s-123", server: "acme", approved: true },
			}),
		);
		expect(thrown).toBeUndefined();
		expect(asksOf(hooks, buffer).answered).toEqual({
			"s-123": { accepted: true, label: "Authorized" },
		});
		expect(hooks.message.run(() => undefined, buffer)).toContain(
			'(load-mcp "acme")',
		);
	});
});
