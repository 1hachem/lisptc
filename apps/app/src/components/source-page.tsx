import { convexQuery } from "@convex-dev/react-query";
import { api } from "@repo/backend/api";
import type { Id } from "@repo/backend/dataModel";
import { useQuery } from "@tanstack/react-query";
import { definitionOf } from "../lib/agent-definition.ts";
import type { PermissionRule } from "../lib/files.ts";
import { PageView } from "./file-view.tsx";
import { Chips, Field, RuleCard } from "./read-only.tsx";

function PermissionsField({ rules }: { rules: PermissionRule[] }) {
	if (rules.length === 0)
		return (
			<Field label="permissions">
				<span className="text-dim">same as the workspace</span>
			</Field>
		);
	return (
		<Field label="permissions" hint="tighten the workspace rules">
			<div className="flex flex-col gap-3">
				{rules.map((rule) => (
					<RuleCard key={rule.start} source={rule.source} />
				))}
			</div>
		</Field>
	);
}

function AgentDefinition({ text }: { text: string }) {
	const definition = definitionOf(text);
	if (definition === undefined)
		return <div className="text-dim">this definition could not be read</div>;
	const { name, prompt, budget, roster, rules } = definition;
	return (
		<div className="flex flex-col gap-4">
			<h1 className="break-words font-medium text-[15px] text-fg">{name}</h1>
			<Field label="instructions">
				<p className="whitespace-pre-wrap break-words leading-relaxed">
					{prompt}
				</p>
			</Field>
			<Field label="step budget">
				{budget === undefined ? (
					<span className="text-dim">no cap</span>
				) : (
					`${budget} steps`
				)}
			</Field>
			{roster !== undefined && (
				<Field label="may start">
					<Chips items={roster} />
				</Field>
			)}
			<PermissionsField rules={rules} />
		</div>
	);
}

export function SourcePage({
	workspaceId,
	folder,
	name,
}: {
	workspaceId: Id<"workspaces">;
	folder: string;
	name: string;
}) {
	const path = `${folder}/${name}`;
	const { data: text, error } = useQuery(
		convexQuery(api.sources.get, { workspaceId, folder, name }),
	);
	if (error) throw error;

	return (
		<PageView title={path}>
			{typeof text === "string" ? (
				<AgentDefinition text={text} />
			) : (
				<div className="text-dim">
					{text === null ? `no ${path}` : "loading…"}
				</div>
			)}
		</PageView>
	);
}
