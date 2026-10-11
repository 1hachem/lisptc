import { createHash } from "node:crypto";
import type {
	AppContainer,
	ConnConfig,
	NamedPort,
	Reclaim,
	Resources,
	StateEntry,
	StateSpec,
} from "./ports.ts";

export interface Launch {
	image: string;
	exposed: string;
	path: string;
	args: string[];
}

export const GROUP = "lisptc.io";
export const VERSION = "v1alpha1";
export const KIND = "McpServer";
export const PLURAL = "mcpservers";

export const NAME_MAX = 63;
export const DEFAULT_STATE_SIZE = "1Gi";
export const DEFAULT_RETENTION_SECONDS = 30 * 24 * 60 * 60;
export const DEFAULT_IDLE_SECONDS = 600;

export const DEFAULT_RESOURCES = {
	requests: { cpu: "100m", memory: "256Mi" },
	limits: { cpu: "2", memory: "2Gi" },
} as const;

export interface State {
	name: string;
	path: string;
	size: string;
	reclaim: Reclaim;
	retentionSeconds: number;
	reset: number;
}

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
	state: State[];
}

export interface AppSlot {
	image: string;
	args: string[];
	ports: NamedPort[];
	expose: string[];
	resources: ResourceRequirements;
	state: State[];
}

export interface McpServerSpec {
	workspace: string;
	server: string;
	mcp: McpSlot;
	app?: AppSlot;
	envSecret: string;
	envHash: string;
	restarts: number;
	lastUsed: number;
	idleSeconds: number;
}

export type ServerPhase = "Starting" | "Ready" | "Sleeping" | "Failed";
export type ClaimPhase = "Bound" | "Pending" | "Resizing" | "Released";

export interface ClaimStatus {
	claim: string;
	phase: ClaimPhase;
	size: string;
	lastAttached?: number;
	observedReset: number;
	reason?: string;
}

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
	state?: Record<string, ClaimStatus>;
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

export interface EnvRef {
	secret: string;
	hash: string;
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

export function serverName(workspace: string, server: string): string {
	const base = dnsLabel(
		`mcp-${dnsLabel(server, 24)}-${dnsLabel(workspace, 24)}`,
		NAME_MAX - 9,
	);
	return `${base}-${shortHash(workspace, server)}`;
}

export function claimName(server: string, state: string): string {
	const base = dnsLabel(`${server}-${dnsLabel(state, 20)}`, NAME_MAX - 9);
	return `${base}-${shortHash(server, state)}`;
}

export function envHash(env: Record<string, string> | undefined): string {
	const entries = Object.entries(env ?? {}).sort(([a], [b]) =>
		a.localeCompare(b),
	);
	return createHash("sha256").update(JSON.stringify(entries)).digest("hex");
}

export function resourcesFor(asked?: Resources): ResourceRequirements {
	return {
		requests: { ...DEFAULT_RESOURCES.requests, ...asked?.requests },
		limits: { ...DEFAULT_RESOURCES.limits, ...asked?.limits },
	};
}

function stateEntry(entry: string | StateEntry): State {
	const asked = typeof entry === "string" ? { path: entry } : entry;
	if (!asked.path.startsWith("/"))
		throw new Error(`state path "${asked.path}" is not absolute.`);
	const name = dnsLabel(
		asked.name ?? asked.path.split("/").filter(Boolean).at(-1) ?? "",
		20,
	);
	if (!name)
		throw new Error(
			`state path "${asked.path}" names no volume; give it a name.`,
		);
	return {
		name,
		path: asked.path,
		size: asked.size ?? DEFAULT_STATE_SIZE,
		reclaim: asked.reclaim ?? "Retain",
		retentionSeconds: asked.retentionSeconds ?? DEFAULT_RETENTION_SECONDS,
		reset: 0,
	};
}

export function stateEntries(spec: StateSpec | undefined): State[] {
	if (spec === undefined) return [];
	return (Array.isArray(spec) ? spec : [spec]).map(stateEntry);
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
		state: stateEntries(app.state),
	};
}

function uniqueStateNames(server: string, slots: State[][]): void {
	const seen = new Set<string>();
	for (const state of slots.flat()) {
		if (seen.has(state.name))
			throw new Error(
				`${server}: two state entries are both named "${state.name}".`,
			);
		seen.add(state.name);
	}
}

export function specFor(
	conf: ConnConfig,
	launch: Launch,
	workspace: string,
	now: number,
	env: EnvRef,
): McpServerSpec {
	const mcp: McpSlot = {
		image: launch.image,
		args: launch.args,
		port: Number(launch.exposed),
		path: launch.path,
		resources: resourcesFor("resources" in conf ? conf.resources : undefined),
		state: stateEntries("state" in conf ? conf.state : undefined),
	};
	const app = "app" in conf && conf.app ? appSlot(conf.app) : undefined;
	uniqueStateNames(conf.name, [mcp.state, app?.state ?? []]);
	return {
		workspace,
		server: conf.name,
		mcp,
		...(app ? { app } : {}),
		envSecret: env.secret,
		envHash: env.hash,
		restarts: 0,
		lastUsed: now,
		idleSeconds: DEFAULT_IDLE_SECONDS,
	};
}

export function workloadHash(spec: McpServerSpec): string {
	const states = (slot: { state: State[] } | undefined) =>
		slot?.state.map(({ name, path }) => ({ name, path })) ?? [];
	return createHash("sha256")
		.update(
			JSON.stringify({
				mcp: { ...spec.mcp, state: states(spec.mcp) },
				app: spec.app ? { ...spec.app, state: states(spec.app) } : null,
				envHash: spec.envHash,
				restarts: spec.restarts,
			}),
		)
		.digest("hex")
		.slice(0, 16);
}
