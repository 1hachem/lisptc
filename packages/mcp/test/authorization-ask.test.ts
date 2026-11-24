import { ConversationInterpreter } from "@repo/interpreter/conversation";
import { StepHold } from "@repo/interpreter/errors";
import { bufferSink } from "@repo/interpreter/journal";
import { boot, type Interp, runSync } from "@repo/interpreter/lisp";
import { openSession } from "@repo/interpreter/session";
import {
	type Asks,
	asksKind,
	unansweredAsks,
} from "@repo/journal-catalog/asks";
import { view } from "@repo/shared/journal";
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
	const interp = new ConversationInterpreter({ extensions: [extension] });
	boot(interp);
	return { interp, hooks: openSession([extension]) };
}

async function step(interp: Interp, run: () => Promise<unknown>) {
	const buffer = bufferSink();
	const detach = interp.journal.pipe(buffer);
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

function asksOf(buffer: ReturnType<typeof bufferSink>): Asks {
	return view(buffer.entries, asksKind);
}

describe("a load that needs a login", () => {
	it("holds the step and asks the user to authorize at the link", async () => {
		const { interp } = session();
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
		const [ask] = asksOf(buffer).open ?? [];
		expect(ask?.id).toBe("s-123");
		expect(ask?.title).toBe("acme");
		expect(ask?.choices.find((c) => c.accepts)?.opens).toBe(AUTH_URL);
	});

	it("closes the ask as declined when the user picks its refusing choice", async () => {
		const { interp, hooks } = session();
		const buffer = bufferSink();
		const detach = interp.journal.pipe(buffer);
		try {
			await Promise.resolve()
				.then(() =>
					runSync(
						interp,
						'(load-mcp :name "acme" :url "https://acme.example/mcp")',
					),
				)
				.catch(() => undefined);
			const [ask] = asksOf(buffer).open ?? [];
			const refusal = ask?.choices.find((c) => !c.accepts);
			if (ask === undefined || refusal === undefined)
				throw new Error("no refusing choice");
			await hooks.invoke.run(() => Promise.reject(new Error("unhandled")), {
				interp,
				...refusal.answer,
			});
			expect(unansweredAsks(asksOf(buffer))).toEqual([]);
			expect(asksOf(buffer).answered?.[ask.id]?.accepted).toBe(false);
		} finally {
			detach();
		}
	});
});
