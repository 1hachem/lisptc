interface GraphReuse {
	name: string;
	from: string;
	step: number;
}

export interface GraphNode {
	id: string;
	step: number;
	index: number;
	head: string | null;
	source: string;
	ok: boolean;
	value?: string;
	error?: string;
	defines: string[];
	reuses: GraphReuse[];
}

interface GraphCarrier {
	type?: string;
	additional_kwargs?: { graph?: unknown };
}

function strings(value: unknown): string[] {
	return Array.isArray(value) ? value.filter((v) => typeof v === "string") : [];
}

function parseReuse(value: unknown): GraphReuse | undefined {
	if (!value || typeof value !== "object") return undefined;
	const raw = value as Record<string, unknown>;
	if (typeof raw.name !== "string" || typeof raw.from !== "string")
		return undefined;
	return {
		name: raw.name,
		from: raw.from,
		step: typeof raw.step === "number" ? raw.step : 0,
	};
}

function parseNode(value: unknown): GraphNode | undefined {
	if (!value || typeof value !== "object") return undefined;
	const raw = value as Record<string, unknown>;
	if (typeof raw.id !== "string" || typeof raw.step !== "number")
		return undefined;
	return {
		id: raw.id,
		step: raw.step,
		index: typeof raw.index === "number" ? raw.index : 0,
		head: typeof raw.head === "string" ? raw.head : null,
		source: typeof raw.source === "string" ? raw.source : "",
		ok: raw.ok !== false,
		value: typeof raw.value === "string" ? raw.value : undefined,
		error: typeof raw.error === "string" ? raw.error : undefined,
		defines: strings(raw.defines),
		reuses: Array.isArray(raw.reuses)
			? raw.reuses
					.map(parseReuse)
					.filter((r): r is GraphReuse => r !== undefined)
			: [],
	};
}

export function collectGraph(messages: GraphCarrier[]): GraphNode[] {
	const byId = new Map<string, GraphNode>();
	for (const message of messages) {
		if (message.type !== "tool") continue;
		const raw = message.additional_kwargs?.graph;
		if (!Array.isArray(raw)) continue;
		for (const entry of raw) {
			const node = parseNode(entry);
			if (node) byId.set(node.id, node);
		}
	}
	return [...byId.values()].sort((a, b) =>
		a.step === b.step ? a.index - b.index : a.step - b.step,
	);
}
