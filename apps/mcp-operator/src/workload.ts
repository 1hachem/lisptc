import type {
	V1Container,
	V1Namespace,
	V1NetworkPolicy,
	V1PersistentVolumeClaim,
	V1Pod,
	V1Secret,
	V1Service,
} from "@kubernetes/client-node";
import {
	claimName,
	dnsLabel,
	type McpServer,
	type ResourceRequirements,
	type State,
	workloadHash,
} from "@repo/mcp-extension/kubernetes";

export const MANAGED_BY = "app.kubernetes.io/managed-by";
export const MANAGER = "lisptc-mcp";
const WORKSPACE_LABEL = "lisptc.io/workspace";
export const SERVER_LABEL = "lisptc.io/mcp-server";
export const STATE_LABEL = "lisptc.io/state";
export const SPEC_HASH = "lisptc.io/spec-hash";
export const RECLAIM = "lisptc.io/reclaim";
export const RETENTION = "lisptc.io/retention";
export const RELEASED_AT = "lisptc.io/released-at";
export const WORKSPACE_ID = "lisptc.io/workspace-id";
export const SERVER_NAME = "lisptc.io/server-name";
export const STATE_PATH = "lisptc.io/state-path";
export const EMPTY_SINCE = "lisptc.io/empty-since";
export const SHM_LIMIT = "1Gi";

const MCP_CONTAINER = "mcp";
const APP_CONTAINER = "app";
const INGRESS_POLICY = "mcp-ingress";
const EGRESS_POLICY = "mcp-egress";
const UNROUTED_FROM_A_SERVER = [
	"10.0.0.0/8",
	"172.16.0.0/12",
	"192.168.0.0/16",
	"100.64.0.0/10",
	"169.254.0.0/16",
];

export interface WorkloadPlacement {
	namespace: string;
	pullSecret?: string;
	storageClass?: string;
}

export function namespaceFor(prefix: string, workspace: string): string {
	const name = dnsLabel(`${prefix}${workspace}`);
	if (!/^[a-z0-9]/.test(name))
		throw new Error(
			`no namespace can be named after the workspace "${workspace}".`,
		);
	return name;
}

export function namespaceManifest(
	name: string,
	workspace: string,
): V1Namespace {
	return {
		metadata: {
			name,
			labels: {
				[MANAGED_BY]: MANAGER,
				[WORKSPACE_LABEL]: dnsLabel(workspace),
				"pod-security.kubernetes.io/enforce": "baseline",
			},
		},
	};
}

export function egressPolicy(): V1NetworkPolicy {
	return {
		metadata: { name: EGRESS_POLICY },
		spec: {
			podSelector: { matchLabels: { [MANAGED_BY]: MANAGER } },
			policyTypes: ["Egress"],
			egress: [
				{
					to: [
						{
							namespaceSelector: {
								matchLabels: { "kubernetes.io/metadata.name": "kube-system" },
							},
							podSelector: { matchLabels: { "k8s-app": "kube-dns" } },
						},
					],
					ports: [
						{ protocol: "UDP", port: 53 },
						{ protocol: "TCP", port: 53 },
					],
				},
				{
					to: [
						{
							ipBlock: { cidr: "0.0.0.0/0", except: UNROUTED_FROM_A_SERVER },
						},
					],
				},
			],
		},
	};
}

export function ingressPolicy(caller: string): V1NetworkPolicy {
	return {
		metadata: { name: INGRESS_POLICY },
		spec: {
			podSelector: { matchLabels: { [MANAGED_BY]: MANAGER } },
			policyTypes: ["Ingress"],
			ingress: [
				{
					_from: [
						{
							namespaceSelector: {
								matchLabels: { "kubernetes.io/metadata.name": caller },
							},
						},
					],
				},
			],
		},
	};
}

function ownLabels(server: McpServer): Record<string, string> {
	return {
		[MANAGED_BY]: MANAGER,
		[WORKSPACE_LABEL]: dnsLabel(server.spec.workspace),
		[SERVER_LABEL]: server.metadata.name,
	};
}

export function selectorFor(name: string): string {
	return `${MANAGED_BY}=${MANAGER},${SERVER_LABEL}=${name}`;
}

function volumeName(state: State): string {
	return `state-${state.name}`;
}

function mounts(states: State[]) {
	return [
		{ name: "shm", mountPath: "/dev/shm" },
		...states.map((state) => ({
			name: volumeName(state),
			mountPath: state.path,
		})),
	];
}

function hardened(
	name: string,
	image: string,
	args: string[],
	resources: ResourceRequirements,
	secret: string,
): V1Container {
	return {
		name,
		image,
		...(args.length > 0 ? { args } : {}),
		envFrom: [{ secretRef: { name: secret } }],
		resources,
		securityContext: { allowPrivilegeEscalation: false },
	};
}

export function statesOf(server: McpServer): State[] {
	return [...server.spec.mcp.state, ...(server.spec.app?.state ?? [])];
}

export function podFor(server: McpServer, placement: WorkloadPlacement): V1Pod {
	const name = server.metadata.name;
	const { mcp, app } = server.spec;
	const containers: V1Container[] = [
		{
			...hardened(MCP_CONTAINER, mcp.image, mcp.args, mcp.resources, name),
			ports: [{ name: MCP_CONTAINER, containerPort: mcp.port }],
			readinessProbe: { tcpSocket: { port: mcp.port }, periodSeconds: 2 },
			volumeMounts: mounts(mcp.state),
		},
	];
	if (app)
		containers.push({
			...hardened(APP_CONTAINER, app.image, app.args, app.resources, name),
			ports: app.ports.map((port) => ({
				name: port.name,
				containerPort: port.port,
			})),
			...(app.ports[0]
				? {
						readinessProbe: {
							tcpSocket: { port: app.ports[0].port },
							periodSeconds: 2,
						},
					}
				: {}),
			volumeMounts: mounts(app.state),
		});
	return {
		metadata: {
			name,
			labels: { ...ownLabels(server), [SPEC_HASH]: workloadHash(server.spec) },
		},
		spec: {
			restartPolicy: "Never",
			automountServiceAccountToken: false,
			enableServiceLinks: false,
			...(placement.pullSecret
				? { imagePullSecrets: [{ name: placement.pullSecret }] }
				: {}),
			containers,
			volumes: [
				{ name: "shm", emptyDir: { medium: "Memory", sizeLimit: SHM_LIMIT } },
				...statesOf(server).map((state) => ({
					name: volumeName(state),
					persistentVolumeClaim: { claimName: claimName(name, state.name) },
				})),
			],
		},
	};
}

export function serviceFor(server: McpServer): V1Service {
	const { mcp, app } = server.spec;
	const exposed = (app?.ports ?? []).filter((port) =>
		app?.expose.includes(port.name),
	);
	return {
		metadata: { name: server.metadata.name, labels: ownLabels(server) },
		spec: {
			selector: {
				[MANAGED_BY]: MANAGER,
				[SERVER_LABEL]: server.metadata.name,
			},
			ports: [
				{ name: MCP_CONTAINER, port: mcp.port, targetPort: mcp.port },
				...exposed.map((port) => ({
					name: port.name,
					port: port.port,
					targetPort: port.port,
				})),
			],
		},
	};
}

export function secretFor(
	server: McpServer,
	data: Record<string, string>,
): V1Secret {
	return {
		metadata: { name: server.metadata.name, labels: ownLabels(server) },
		type: "Opaque",
		data,
	};
}

export function claimTerms(state: State): Record<string, string> {
	return {
		[RECLAIM]: state.reclaim,
		[RETENTION]: String(state.retentionSeconds),
	};
}

export function claimFor(
	server: McpServer,
	state: State,
	placement: WorkloadPlacement,
): V1PersistentVolumeClaim {
	return {
		metadata: {
			name: claimName(server.metadata.name, state.name),
			labels: { ...ownLabels(server), [STATE_LABEL]: state.name },
			annotations: {
				...claimTerms(state),
				[WORKSPACE_ID]: server.spec.workspace,
				[SERVER_NAME]: server.spec.server,
				[STATE_PATH]: state.path,
			},
		},
		spec: {
			accessModes: ["ReadWriteOnce"],
			resources: { requests: { storage: state.size } },
			...(placement.storageClass
				? { storageClassName: placement.storageClass }
				: {}),
		},
	};
}

export function endpointsFor(
	server: McpServer,
	origin: (port: number) => string,
): Record<string, string> {
	const { mcp, app } = server.spec;
	const endpoints: Record<string, string> = {
		mcp: new URL(mcp.path, origin(mcp.port)).toString(),
	};
	for (const port of app?.ports ?? [])
		if (app?.expose.includes(port.name))
			endpoints[port.name] = origin(port.port);
	return endpoints;
}
