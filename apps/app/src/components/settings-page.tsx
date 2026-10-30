import { convexQuery, useConvexMutation } from "@convex-dev/react-query";
import { HugeiconsIcon } from "@hugeicons/react";
import { api } from "@repo/backend/api";
import type { Id } from "@repo/backend/dataModel";
import { WORKSPACE_ICONS, workspaceIcon } from "@repo/backend/workspace-icons";
import { DEFAULT_CHOICE } from "@repo/shared/providers";
import { Button, Input } from "@repo/ui";
import { contentRegion } from "@repo/ui-catalog";
import { useQuery } from "@tanstack/react-query";
import { type ReactNode, useState } from "react";
import { useAppearance } from "../lib/appearance.tsx";
import { useModelPicker } from "../lib/model-picker.tsx";
import { themeOf } from "../lib/resolved-preferences.ts";
import { ICONS } from "../lib/workspace-icons.ts";

function Field({ label, children }: { label: string; children: ReactNode }) {
	return (
		<div className="flex flex-col gap-1.5">
			<div className="text-[11px] text-dim uppercase tracking-[0.14em]">
				{label}
			</div>
			{children}
		</div>
	);
}

function NameField({
	workspaceId,
	name,
}: {
	workspaceId: Id<"workspaces">;
	name: string;
}) {
	const rename = useConvexMutation(api.workspaces.rename);
	const [draft, setDraft] = useState(name);
	const save = () => {
		const next = draft.trim();
		if (next === "" || next === name) return setDraft(name);
		void rename({ workspaceId, name: next });
	};
	return (
		<Input
			aria-label="workspace name"
			value={draft}
			onChange={(event) => setDraft(event.target.value)}
			onBlur={save}
			onKeyDown={(event) => {
				if (event.key === "Enter") save();
			}}
			className="h-control-sm max-w-80 rounded-none font-mono"
		/>
	);
}

function IconField({
	workspaceId,
	current,
}: {
	workspaceId: Id<"workspaces">;
	current: string;
}) {
	const setIcon = useConvexMutation(api.workspaces.setIcon);
	return (
		<div className="flex flex-wrap gap-px">
			{WORKSPACE_ICONS.map((icon) => (
				<button
					key={icon}
					type="button"
					title={icon}
					aria-label={`use the ${icon} icon`}
					aria-pressed={icon === current}
					onClick={() => void setIcon({ workspaceId, icon })}
					className={`cursor-pointer p-1 hover:bg-bg2 ${icon === current ? "bg-bg2 text-fg" : "text-dim"}`}
				>
					<HugeiconsIcon className="size-icon-sm" icon={ICONS[icon]} />
				</button>
			))}
		</div>
	);
}

function Picked({
	value,
	action,
	onPick,
}: {
	value: string;
	action: string;
	onPick: () => void;
}) {
	return (
		<div className="flex min-w-0 items-center gap-2">
			<span className="min-w-0 truncate">{value}</span>
			<Button
				type="button"
				size="sm"
				variant="outline"
				className="rounded-none font-mono"
				onClick={onPick}
			>
				{action}
			</Button>
		</div>
	);
}

export function SettingsPage({
	workspaceId,
}: {
	workspaceId: Id<"workspaces">;
}) {
	const { data: workspace, error } = useQuery(
		convexQuery(api.workspaces.get, { workspaceId }),
	);
	if (error) throw error;
	const { openModelPicker } = useModelPicker();
	const { openThemePicker } = useAppearance();
	if (!workspace) return null;
	const model = workspace.model ?? DEFAULT_CHOICE;

	return (
		<div
			{...contentRegion}
			className="flex h-full min-w-0 flex-col gap-5 overflow-y-auto p-4 text-[11.5px]"
		>
			<Field label="name">
				<NameField
					key={workspace.name}
					workspaceId={workspaceId}
					name={workspace.name}
				/>
			</Field>
			<Field label="icon">
				<IconField
					workspaceId={workspaceId}
					current={workspaceIcon(workspace)}
				/>
			</Field>
			<Field label="model">
				<Picked
					value={`${model.provider}/${model.model}`}
					action="change model"
					onPick={openModelPicker}
				/>
			</Field>
			<Field label="theme">
				<Picked
					value={themeOf(workspace)}
					action="change theme"
					onPick={openThemePicker}
				/>
			</Field>
		</div>
	);
}
