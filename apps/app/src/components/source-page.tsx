import { convexQuery } from "@convex-dev/react-query";
import { api } from "@repo/backend/api";
import type { Id } from "@repo/backend/dataModel";
import { useQuery } from "@tanstack/react-query";
import { permissionRules } from "../lib/files.ts";
import { callOf, plainText, readForm } from "../lib/form-reader.ts";
import { PageView } from "./file-view.tsx";
import { Chips, Field, RuleCard } from "./read-only.tsx";

function AgentDefinition({ text }: { text: string }) {
	const call = callOf(readForm(text));
	const name = call?.args[0];
	if (call?.head !== "defagent" || name?.kind !== "string")
		return <div className="text-dim">this definition could not be read</div>;
	const prompt = call.options.get("prompt");
	const permissions = call.options.get("permissions");
	const roster = call.options.get("roster");
	const budget = call.options.get("budget");
	const rules =
		permissions?.kind === "string" ? permissionRules(permissions.value) : [];

	return (
		<div className="flex flex-col gap-4">
			<h1 className="break-words font-medium text-[15px] text-fg">
				{name.value}
			</h1>
			<Field label="instructions">
				<p className="whitespace-pre-wrap break-words leading-relaxed">
					{prompt === undefined ? "" : plainText(prompt)}
				</p>
			</Field>
			<Field label="step budget">
				{budget === undefined ? (
					<span className="text-dim">no cap</span>
				) : (
					`${plainText(budget)} steps`
				)}
			</Field>
			{roster !== undefined && (
				<Field label="may start">
					<Chips
						items={
							roster.kind === "list"
								? roster.items.map(plainText)
								: [plainText(roster)]
						}
					/>
				</Field>
			)}
			<Field
				label="permissions"
				hint={rules.length === 0 ? undefined : "tighten the workspace rules"}
			>
				{rules.length === 0 ? (
					<span className="text-dim">same as the workspace</span>
				) : (
					<div className="flex flex-col gap-3">
						{rules.map((rule) => (
							<RuleCard key={rule.start} source={rule.source} />
						))}
					</div>
				)}
			</Field>
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
