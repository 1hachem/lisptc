import { convexQuery, useConvexMutation } from "@convex-dev/react-query";
import { HugeiconsIcon } from "@hugeicons/react";
import { api } from "@repo/backend/api";
import type { Doc, Id } from "@repo/backend/dataModel";
import { WORKSPACE_ICONS, workspaceIcon } from "@repo/backend/workspace-icons";
import { ThemeSwatches } from "@repo/components";
import { DEFAULT_CHOICE, PROVIDER_CATALOG } from "@repo/shared/providers";
import { Input } from "@repo/ui";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useAppearance } from "../lib/appearance.tsx";
import { useAttempt } from "../lib/attempt.ts";
import { useModelPicker } from "../lib/model-picker.tsx";
import { useSetIcon } from "../lib/set-icon.ts";
import { ICONS } from "../lib/workspace-icons.ts";
import { PageView } from "./file-view.tsx";
import { Field } from "./read-only.tsx";

function NameField({ workspace }: { workspace: Doc<"workspaces"> }) {
	const rename = useConvexMutation(api.workspaces.rename);
	const { failure, attempt } = useAttempt("rename");
	const [draft, setDraft] = useState<string | null>(null);
	const save = () => {
		const name = draft?.trim();
		setDraft(null);
		if (!name || name === workspace.name) return;
		attempt(() => rename({ workspaceId: workspace._id, name }));
	};
	return (
		<Field label="name" hint={failure ?? undefined}>
			<form
				onSubmit={(event) => {
					event.preventDefault();
					save();
				}}
			>
				<Input
					aria-label="workspace name"
					value={draft ?? workspace.name}
					onChange={(event) => setDraft(event.target.value)}
					onBlur={save}
					onKeyDown={(event) => {
						if (event.key === "Escape") setDraft(null);
					}}
					className="h-control"
				/>
			</form>
		</Field>
	);
}

function ChangeButton({ onClick }: { onClick: () => void }) {
	return (
		<button
			type="button"
			onClick={onClick}
			className="flex-none cursor-pointer text-dim hover:text-fg"
		>
			change
		</button>
	);
}

function ModelField({ workspace }: { workspace: Doc<"workspaces"> }) {
	const { openModelPicker } = useModelPicker();
	const choice = workspace.model ?? DEFAULT_CHOICE;
	const provider = PROVIDER_CATALOG[choice.provider];
	const model = provider.models.find((entry) => entry.id === choice.model);
	return (
		<Field label="model">
			<div className="flex items-baseline gap-3">
				<span className="min-w-0 flex-1 truncate">
					{model?.name ?? choice.model}
					<span className="text-dim"> · {provider.label}</span>
				</span>
				<ChangeButton onClick={openModelPicker} />
			</div>
		</Field>
	);
}

function IconField({ workspace }: { workspace: Doc<"workspaces"> }) {
	const setIcon = useSetIcon();
	const current = workspaceIcon(workspace);
	return (
		<Field label="icon">
			<div className="flex flex-wrap gap-1">
				{WORKSPACE_ICONS.map((icon) => (
					<button
						key={icon}
						type="button"
						title={icon}
						aria-label={`use the ${icon} icon`}
						aria-pressed={icon === current}
						onClick={() => void setIcon({ workspaceId: workspace._id, icon })}
						className={`flex h-control w-control cursor-pointer items-center justify-center rounded-sm ${icon === current ? "bg-bg2 text-fg" : "text-dim hover:text-fg"}`}
					>
						<HugeiconsIcon className="size-icon" icon={ICONS[icon]} />
					</button>
				))}
			</div>
		</Field>
	);
}

function ThemeField() {
	const { theme, openThemePicker } = useAppearance();
	return (
		<Field label="theme">
			<div className="flex items-center gap-3">
				<ThemeSwatches theme={theme} />
				<span className="min-w-0 flex-1 truncate">{theme.name}</span>
				<ChangeButton onClick={openThemePicker} />
			</div>
		</Field>
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

	return (
		<PageView title="settings">
			{workspace === undefined ? (
				<div className="text-dim">loading…</div>
			) : (
				<div className="flex flex-col gap-4">
					<NameField workspace={workspace} />
					<ModelField workspace={workspace} />
					<IconField workspace={workspace} />
					<ThemeField />
				</div>
			)}
		</PageView>
	);
}
