import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";
import type {
	ServerRow,
	Snapshot,
	StatusSink,
	Workspaces,
} from "./status-sink.ts";

type ServerArgs = Omit<ServerRow, "workspace"> & { workspaceId: string };

const observeServer = makeFunctionReference<"mutation", ServerArgs, null>(
	"mcpServers:observeServer",
);
const reconcile = makeFunctionReference<
	"mutation",
	{ servers: ServerArgs[] },
	null
>("mcpServers:reconcile");

const existing = makeFunctionReference<"query", { ids: string[] }, string[]>(
	"workspaces:existing",
);

const EXISTING_BATCH = 256;

function asArgs<T extends { workspace: string }>({
	workspace,
	...rest
}: T): Omit<T, "workspace"> & { workspaceId: string } {
	return { ...rest, workspaceId: workspace };
}

function adminClient(url: string, adminKey: string): ConvexHttpClient {
	const client = new ConvexHttpClient(url);
	(client as unknown as { setAdminAuth(key: string): void }).setAdminAuth(
		adminKey,
	);
	return client;
}

export function convexWorkspaces(url: string, adminKey: string): Workspaces {
	const client = adminClient(url, adminKey);
	return {
		async existing(ids) {
			const found = new Set<string>();
			for (let at = 0; at < ids.length; at += EXISTING_BATCH)
				for (const id of await client.query(existing, {
					ids: ids.slice(at, at + EXISTING_BATCH),
				}))
					found.add(id);
			return found;
		},
	};
}

export function convexSink(url: string, adminKey: string): StatusSink {
	const client = adminClient(url, adminKey);
	return {
		async observeServer(row) {
			await client.mutation(observeServer, asArgs(row));
		},
		async reconcile(snapshot: Snapshot) {
			await client.mutation(reconcile, {
				servers: snapshot.servers.map(asArgs),
			});
		},
	};
}
