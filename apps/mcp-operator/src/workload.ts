import { createHash } from "node:crypto";
import type {
	V1Container,
	V1DaemonSet,
	V1Namespace,
	V1NetworkPolicy,
	V1Pod,
	V1Service,
} from "@kubernetes/client-node";
import {
	dnsLabel,
	type McpServer,
	type McpServerSpec,
	type ResourceRequirements,
	retagged,
	workloadHash,
} from "@repo/mcp-extension/kubernetes";
import type { RowOwner } from "./status-sink.ts";

export const MANAGED_BY = "app.kubernetes.io/managed-by";
export const MANAGER = "lisptc-mcp";
const WORKSPACE_LABEL = "lisptc.io/workspace";
export const SERVER_LABEL = "lisptc.io/mcp-server";
export const SPEC_HASH = "lisptc.io/spec-hash";
export const EMPTY_SINCE = "lisptc.io/empty-since";
export const SHM_LIMIT = "1Gi";

const MCP_CONTAINER = "mcp";
const APP_CONTAINER = "app";
const INGRESS_POLICY = "mcp-ingress";
const EGRESS_POLICY = "mcp-egress";
const PREPULL = "mcp-prepull";
export const PREPULL_SELECTOR = `app.kubernetes.io/name=${PREPULL}`;
const PAUSE_IMAGE = "registry.k8s.io/pause:3.10";
const PREPULL_RESOURCES = {
	requests: { cpu: "1m", memory: "8Mi" },
	limits: { memory: "32Mi" },
};
const UNROUTED_FROM_A_SERVER = [
	"10.0.0.0/8",
	"172.16.0.0/12",
	"192.168.0.0/16",
	"100.64.0.0/10",
	"169.254.0.0/16",
];

export interface Rollout {
	tag: string;
	repositories: string[];
}

export function repositoryOf(image: string): string {
	return image.replace(/@.*$/, "").replace(/:[^:/]+$/, "");
}

export function rolledOut(
	spec: McpServerSpec,
	rollout: Rollout | undefined,
): McpServerSpec {
	if (!rollout?.repositories.includes(repositoryOf(spec.mcp.image)))
		return spec;
	return {
		...spec,
		mcp: { ...spec.mcp, image: retagged(spec.mcp.image, rollout.tag) },
	};
}

export interface WorkloadPlacement {
	namespace: string;
	pullSecret?: string;
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

const MOUNTS = [{ name: "shm", mountPath: "/dev/shm" }];

function hardened(
	name: string,
	image: string,
	args: string[],
	resources: ResourceRequirements,
): V1Container {
	return {
		name,
		image,
		...(args.length > 0 ? { args } : {}),
		resources,
		securityContext: { allowPrivilegeEscalation: false },
	};
}

export function podFor(server: McpServer, placement: WorkloadPlacement): V1Pod {
	const name = server.metadata.name;
	const { mcp, app } = server.spec;
	const containers: V1Container[] = [
		{
			...hardened(MCP_CONTAINER, mcp.image, mcp.args, mcp.resources),
			ports: [{ name: MCP_CONTAINER, containerPort: mcp.port }],
			readinessProbe: { tcpSocket: { port: mcp.port }, periodSeconds: 2 },
			volumeMounts: MOUNTS,
			...(mcp.secret ? { envFrom: [{ secretRef: { name: mcp.secret } }] } : {}),
		},
	];
	if (app)
		containers.push({
			...hardened(APP_CONTAINER, app.image, app.args, app.resources),
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
			volumeMounts: MOUNTS,
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

function digest(...parts: string[]): string {
	return createHash("sha256").update(parts.join("\0")).digest("hex");
}

function prepullName(image: string): string {
	const repository = repositoryOf(image);
	const base = repository.split("/").pop() ?? repository;
	return `${PREPULL}-${dnsLabel(base, 30)}-${digest(repository).slice(0, 6)}`;
}

function prepullOne(image: string, pullSecret?: string): V1DaemonSet {
	const name = prepullName(image);
	const labels = {
		"app.kubernetes.io/name": PREPULL,
		"app.kubernetes.io/instance": name,
		"app.kubernetes.io/part-of": "lisptc",
	};
	return {
		metadata: {
			name,
			labels,
			annotations: {
				[SPEC_HASH]: digest(image, pullSecret ?? "").slice(0, 16),
			},
		},
		spec: {
			selector: { matchLabels: labels },
			template: {
				metadata: { labels },
				spec: {
					automountServiceAccountToken: false,
					enableServiceLinks: false,
					terminationGracePeriodSeconds: 0,
					...(pullSecret ? { imagePullSecrets: [{ name: pullSecret }] } : {}),
					initContainers: [
						{
							name: "fetch",
							image,
							command: ["true"],
							resources: PREPULL_RESOURCES,
							securityContext: { allowPrivilegeEscalation: false },
						},
					],
					containers: [
						{
							name: "hold",
							image: PAUSE_IMAGE,
							resources: PREPULL_RESOURCES,
							securityContext: { allowPrivilegeEscalation: false },
						},
					],
				},
			},
		},
	};
}

export function prepullFor(
	images: string[],
	pullSecret?: string,
): V1DaemonSet[] {
	return [...new Set(images)]
		.sort()
		.map((image) => prepullOne(image, pullSecret));
}

export function ownerOf(server: McpServer): RowOwner {
	const { workspace, server: name, instance } = server.spec;
	return {
		workspace,
		server: name,
		...(instance ? { instance } : {}),
	};
}
