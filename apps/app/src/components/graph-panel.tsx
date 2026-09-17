import { useCallback, useMemo, useState } from "react";
import { captureGraphNodeSelected } from "../lib/analytics.tsx";
import { useChatSession } from "../lib/chat.tsx";
import { collectGraph, type GraphNode } from "../lib/graph.ts";
import { LispText } from "./lisp-text.tsx";

function GraphCard({
	node,
	open,
	onSelect,
	onFollow,
}: {
	node: GraphNode;
	open: boolean;
	onSelect: () => void;
	onFollow: (id: string) => void;
}) {
	return (
		<div
			className={`border-l pl-2 ${open ? "border-yellow/70" : "border-dim/30"}`}
		>
			<button
				type="button"
				onClick={onSelect}
				className="flex w-full items-baseline gap-2 text-left"
			>
				<span className="flex-none tabular-nums text-dim">
					{node.step}.{node.index}
				</span>
				<span
					aria-hidden
					className={`size-1.5 flex-none translate-y-[-1px] rounded-full ${node.ok ? "bg-green" : "bg-red"}`}
				/>
				<span className="flex-1 truncate text-fg">{node.head ?? "form"}</span>
				{node.reuses.length > 0 && (
					<span className="flex-none text-yellow">↑{node.reuses.length}</span>
				)}
			</button>
			{open && (
				<div className="mt-1 mb-1.5 flex flex-col gap-1.5">
					<div className="whitespace-pre-wrap break-words text-dim">
						<LispText>{node.source}</LispText>
					</div>
					{node.ok
						? node.value !== undefined && (
								<div className="break-words text-green">⇒ {node.value}</div>
							)
						: node.error && (
								<div className="break-words text-red">{node.error}</div>
							)}
					{node.defines.length > 0 && (
						<div className="text-dim">defines {node.defines.join(", ")}</div>
					)}
					{node.reuses.length > 0 && (
						<div className="flex flex-wrap gap-1">
							{node.reuses.map((reuse) => (
								<button
									key={`${reuse.from}:${reuse.name}`}
									type="button"
									onClick={() => onFollow(reuse.from)}
									className="bg-bg2 px-1.5 py-px text-yellow hover:brightness-125"
									title={`defined in step ${reuse.step}`}
								>
									{reuse.name} · step {reuse.step}
								</button>
							))}
						</div>
					)}
				</div>
			)}
		</div>
	);
}

export function GraphPanel() {
	const { messages } = useChatSession();
	const nodes = useMemo(() => collectGraph(messages), [messages]);
	const byId = useMemo(
		() => new Map(nodes.map((node) => [node.id, node])),
		[nodes],
	);
	const [selected, setSelected] = useState<string | null>(null);

	const select = useCallback(
		(id: string) => {
			const opening = selected !== id;
			setSelected(opening ? id : null);
			if (opening) {
				const node = byId.get(id);
				captureGraphNodeSelected({
					step: node?.step,
					head: node?.head ?? undefined,
					reuses: node?.reuses.length ?? 0,
					ok: node?.ok,
				});
			}
		},
		[selected, byId],
	);

	if (nodes.length === 0)
		return (
			<div className="px-4 text-[11.5px] text-dim">
				no forms have run yet. the graph fills in as the agent evaluates code.
			</div>
		);

	return (
		<div className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto px-4 text-[11.5px]">
			{nodes.map((node) => (
				<GraphCard
					key={node.id}
					node={node}
					open={selected === node.id}
					onSelect={() => select(node.id)}
					onFollow={(id) => {
						if (byId.has(id)) setSelected(id);
					}}
				/>
			))}
		</div>
	);
}
