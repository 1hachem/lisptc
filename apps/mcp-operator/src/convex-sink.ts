import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";
import type {
	ServerRow,
	Snapshot,
	StateRow,
	StatusSink,
} from "./status-sink.ts";

type ServerArgs = Omit<ServerRow, "workspace"> & { workspaceId: string };
type StateArgs = Omit<StateRow, "workspace"> & { workspaceId: string };

const observeServer = makeFunctionReference<"mutation", ServerArgs, null>(
	"mcpServers:observeServer",
);
const observeState = makeFunctionReference<"mutation", StateArgs, null>(
	"mcpServers:observeState",
);
const reconcile = makeFunctionReference<
	"mutation",
	{ servers: ServerArgs[]; state: StateArgs[] },
	null
>("mcpServers:reconcile");

function asArgs<T extends { workspace: string }>({
	workspace,
	...rest
}: T): Omit<T, "workspace"> & { workspaceId: string } {
	return { ...rest, workspaceId: workspace };
}

export function convexSink(url: string, adminKey: string): StatusSink {
	const client = new ConvexHttpClient(url);
	(client as unknown as { setAdminAuth(key: string): void }).setAdminAuth(
		adminKey,
	);
	return {
		async observeServer(row) {
			await client.mutation(observeServer, asArgs(row));
		},
		async observeState(row) {
			await client.mutation(observeState, asArgs(row));
		},
		async reconcile(snapshot: Snapshot) {
			await client.mutation(reconcile, {
				servers: snapshot.servers.map(asArgs),
				state: snapshot.state.map(asArgs),
			});
		},
	};
}
