import { randomUUID } from "node:crypto";
import {
	refKey,
	type ServerReport,
	type ServerReporter,
} from "@repo/mcp-extension/ports";
import type { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api.js";
import type { Id } from "../convex/_generated/dataModel.js";
import { MCP_REPORT_BEAT_MS } from "../convex/limits.js";

export type ReportsClient = Pick<ConvexHttpClient, "mutation">;

function running({ phase }: ServerReport): boolean {
	return phase === "starting" || phase === "ready";
}

export function reportsOf(
	workspaceId: Id<"workspaces">,
	connect: () => ReportsClient,
): ServerReporter {
	const reporter = randomUUID();
	const held = new Map<string, ServerReport>();
	let sent: Promise<unknown> = Promise.resolve();
	let beating: ReturnType<typeof setInterval> | undefined;

	const send = (call: () => Promise<unknown>) => {
		sent = sent.then(call).catch(() => {});
	};

	const beat = () => {
		const servers = [...held.values()];
		if (!servers.some(running)) {
			clearInterval(beating);
			beating = undefined;
			return;
		}
		send(() =>
			connect().mutation(api.mcpServers.heartbeat, {
				workspaceId,
				reporter,
				servers,
			}),
		);
	};

	return (report) => {
		const key = refKey({ name: report.server, instance: report.instance });
		if (report.phase === "gone") held.delete(key);
		else held.set(key, report);
		send(() =>
			connect().mutation(api.mcpServers.report, {
				workspaceId,
				reporter,
				...report,
			}),
		);
		if (beating === undefined && running(report)) {
			beating = setInterval(beat, MCP_REPORT_BEAT_MS);
			beating.unref();
		}
	};
}
