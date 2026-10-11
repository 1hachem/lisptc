export const LOG_TOPICS = ["console", "function_execution"] as const;

export interface LogStreamTarget {
	deploymentUrl: string;
	adminKey: string;
	projectToken: string;
	host: string;
	serviceName: string;
}

interface ListedStream {
	id: string;
	logStreamType: string;
}

export async function syncPostHogLogStream(
	target: LogStreamTarget,
	fetchImpl: typeof fetch = fetch,
): Promise<"created" | "updated"> {
	const call = async (path: string, init?: RequestInit) => {
		const response = await fetchImpl(
			new URL(`/api/v1/${path}`, target.deploymentUrl),
			{
				...init,
				headers: {
					Authorization: `Convex ${target.adminKey}`,
					"Content-Type": "application/json",
				},
			},
		);
		if (!response.ok)
			throw new Error(
				`${path} failed: ${response.status} ${await response.text()}`,
			);
		return response;
	};

	const config = {
		logStreamType: "postHogLogs",
		apiKey: target.projectToken,
		host: target.host,
		serviceName: target.serviceName,
		topics: LOG_TOPICS,
	};

	const streams = (await (
		await call("list_log_streams")
	).json()) as ListedStream[];
	const existing = streams.find((s) => s.logStreamType === "postHogLogs");

	if (existing) {
		await call(`update_log_stream/${existing.id}`, {
			method: "POST",
			body: JSON.stringify(config),
		});
		return "updated";
	}
	await call("create_log_stream", {
		method: "POST",
		body: JSON.stringify(config),
	});
	return "created";
}
