import { describe, expect, test } from "vitest";
import {
	LOG_TOPICS,
	type LogStreamTarget,
	syncPostHogLogStream,
} from "../src/log-stream.ts";

const target: LogStreamTarget = {
	deploymentUrl: "http://convex-backend:3210",
	adminKey: "admin-key",
	projectToken: "phc_test",
	host: "https://us.i.posthog.com",
	serviceName: "backend-prod",
};

interface Call {
	url: string;
	method: string;
	authorization: string | null;
	body: unknown;
}

function backend(streams: { id: string; logStreamType: string }[]) {
	const calls: Call[] = [];
	const fetchImpl = (async (input: URL | RequestInfo, init?: RequestInit) => {
		calls.push({
			url: input.toString(),
			method: init?.method ?? "GET",
			authorization: new Headers(init?.headers).get("authorization"),
			body: init?.body ? JSON.parse(init.body as string) : undefined,
		});
		if (input.toString().endsWith("/list_log_streams"))
			return Response.json(streams);
		return Response.json({ id: "new", logStreamType: "postHogLogs" });
	}) as typeof fetch;
	return { calls, fetchImpl };
}

const expectedConfig = {
	logStreamType: "postHogLogs",
	apiKey: "phc_test",
	host: "https://us.i.posthog.com",
	serviceName: "backend-prod",
	topics: [...LOG_TOPICS],
};

describe("syncPostHogLogStream", () => {
	test("creates the stream when the deployment has none", async () => {
		const { calls, fetchImpl } = backend([
			{ id: "dd", logStreamType: "datadog" },
		]);

		expect(await syncPostHogLogStream(target, fetchImpl)).toBe("created");
		expect(calls.map((c) => [c.method, c.url])).toEqual([
			["GET", "http://convex-backend:3210/api/v1/list_log_streams"],
			["POST", "http://convex-backend:3210/api/v1/create_log_stream"],
		]);
		expect(calls.every((c) => c.authorization === "Convex admin-key")).toBe(
			true,
		);
		expect(calls[1]?.body).toEqual(expectedConfig);
	});

	test("updates the existing posthog stream in place", async () => {
		const { calls, fetchImpl } = backend([
			{ id: "ph1", logStreamType: "postHogLogs" },
		]);

		expect(await syncPostHogLogStream(target, fetchImpl)).toBe("updated");
		expect(calls[1]?.url).toBe(
			"http://convex-backend:3210/api/v1/update_log_stream/ph1",
		);
		expect(calls[1]?.body).toEqual(expectedConfig);
	});

	test("fails loudly when the deployment refuses", async () => {
		const fetchImpl = (async () =>
			new Response("bad admin key", { status: 401 })) as typeof fetch;

		await expect(syncPostHogLogStream(target, fetchImpl)).rejects.toThrow(
			"list_log_streams failed: 401 bad admin key",
		);
	});
});
