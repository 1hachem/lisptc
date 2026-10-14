import { type Check, imports } from "./check.ts";

const HOST_DIR = "packages/mcp/src/";

const CLIENT = "@kubernetes/client-node";

const ALLOWED = [
	"ApiException",
	"CustomObjectsApi",
	"KubeConfig",
	"PatchStrategy",
	"setHeaderOptions",
];

export const mcpCluster: Check = {
	name: "MCP host cluster access",
	rule: [
		"The MCP host imports a Kubernetes client beyond the custom-objects one.",
		"It only writes McpServer resources and waits on their status;",
		"apps/mcp-operator alone creates the pods, services, volumes and",
		"namespaces that run them, so nothing here applies them imperatively.",
	],
	fix: [
		"Add what the host needs as a field on the McpServer spec",
		"(packages/mcp/src/mcp-server-resource.ts and charts/lisptc/crds),",
		"and make the operator act on it.",
	],
	run: (tree) =>
		tree.sources
			.filter((file) => file.startsWith(HOST_DIR))
			.flatMap((file) =>
				imports(tree.read(file))
					.filter(({ module }) => module === CLIENT)
					.flatMap(({ names }) =>
						names.map((name) => name.replace(/^type\s+/, "")),
					)
					.filter((name) => !ALLOWED.includes(name))
					.map((name) => ({ file, what: `imports ${name} from ${CLIENT}` })),
			),
};
