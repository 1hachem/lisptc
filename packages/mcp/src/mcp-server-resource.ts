import { createHash } from "node:crypto";
import type { RunSpec } from "@repo/containers/launch";
import type {
	AppContainer,
	NamedPort,
	RemoteEntry,
	Resources,
} from "@repo/toolkit";

export const GROUP = "lisptc.io";
export const VERSION = "v1alpha1";
export const KIND = "McpServer";
export const PLURAL = "mcpservers";

export const NAME_MAX = 63;
export const DEFAULT_IDLE_SECONDS = 600;

export const DEFAULT_RESOURCES = {
	requests: { cpu: "100m", memory: "256Mi" },
	limits: { cpu: "2", memory: "2Gi" },
} as const;

export interface ResourceRequirements {
	requests: Record<string, string>;
	limits: Record<string, string>;
}

export interface McpSlot {
	image: string;
	args: string[];
	port: number;
	path: string;
	resources: ResourceRequirements;
	secret?: string;
}

export interface AppSlot {
	image: string;
	args: string[];
	ports: NamedPort[];
	expose: string[];
	resources: ResourceRequirements;
}

export interface RemoteSlot {
	url: string;
}

export interface McpServerSpec {
	workspace: string;
	server: string;
	instance?: string;
	mcp?: McpSlot;
	app?: AppSlot;
	remote?: RemoteSlot;
	restarts: number;
	lastUsed: number;
	idleSeconds: number;
}

export type ServerPhase = "Starting" | "Ready" | "Sleeping" | "Failed";
export interface Condition {
	type: string;
	status: "True" | "False" | "Unknown";
	reason?: string;
	message?: string;
	lastTransitionTime: string;
}

export interface McpServerStatus {
	phase?: ServerPhase;
	reason?: string;
	endpoints?: Record<string, string>;
	logTail?: string;
	observedGeneration?: number;
	conditions?: Condition[];
}

export interface McpServer {
	apiVersion: string;
	kind: string;
	metadata: {
		name: string;
		namespace?: string;
		uid?: string;
		generation?: number;
		deletionTimestamp?: string | Date;
		finalizers?: string[];
		labels?: Record<string, string>;
	};
	spec: McpServerSpec;
	status?: McpServerStatus;
}

export function dnsLabel(value: string, max = NAME_MAX): string {
	return value
		.toLowerCase()
		.replace(/[^a-z0-9-]+/g, "-")
		.slice(0, max)
		.replace(/^-+|-+$/g, "");
}

function shortHash(...parts: string[]): string {
	return createHash("sha256")
		.update(parts.join("\0"))
		.digest("hex")
		.slice(0, 8);
}

export function serverName(
	workspace: string,
	server: string,
	instance?: string,
): string {
	const base = dnsLabel(
		`mcp-${dnsLabel(server, 24)}-${dnsLabel(workspace, 24)}`,
		NAME_MAX - 9,
	);
	const hashed =
		instance === undefined
			? [workspace, server]
			: [workspace, server, instance];
	return `${base}-${shortHash(...hashed)}`;
}

export function resourcesFor(asked?: Resources): ResourceRequirements {
	return {
		requests: { ...DEFAULT_RESOURCES.requests, ...asked?.requests },
		limits: { ...DEFAULT_RESOURCES.limits, ...asked?.limits },
	};
}

function appSlot(app: AppContainer): AppSlot {
	const ports = app.ports ?? [];
	const expose = app.expose ?? [];
	for (const name of expose)
		if (!ports.some((port) => port.name === name))
			throw new Error(
				`app exposes "${name}" but declares no port by that name.`,
			);
	return {
		image: app.image,
		args: app.args ?? [],
		ports,
		expose,
		resources: resourcesFor(app.resources),
	};
}

export function specFor(
	run: RunSpec,
	workspace: string,
	now: number,
	instance?: string,
): McpServerSpec {
	const { launch } = run;
	const mcp: McpSlot = {
		image: launch.image,
		args: launch.args,
		port: Number(launch.exposed),
		path: launch.path,
		resources: resourcesFor(run.resources),
		...(run.secret ? { secret: run.secret.name } : {}),
	};
	const app = run.app ? appSlot(run.app) : undefined;
	return {
		workspace,
		server: run.name,
		...(instance === undefined ? {} : { instance }),
		mcp,
		...(app ? { app } : {}),
		restarts: 0,
		lastUsed: now,
		idleSeconds: DEFAULT_IDLE_SECONDS,
	};
}

export function remoteSpecFor(
	conf: RemoteEntry,
	workspace: string,
	now: number,
): McpServerSpec {
	return {
		workspace,
		server: conf.name,
		remote: { url: conf.url },
		restarts: 0,
		lastUsed: now,
		idleSeconds: DEFAULT_IDLE_SECONDS,
	};
}

export function containerOf(spec: McpServerSpec): McpSlot {
	if (spec.mcp === undefined)
		throw new Error(`${spec.server} runs no container: it is a remote server.`);
	return spec.mcp;
}

export function workloadHash(spec: McpServerSpec): string {
	return createHash("sha256")
		.update(
			JSON.stringify({
				mcp: spec.mcp ?? null,
				app: spec.app ?? null,
				restarts: spec.restarts,
			}),
		)
		.digest("hex")
		.slice(0, 16);
}
