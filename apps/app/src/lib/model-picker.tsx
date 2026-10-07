import { useConvexMutation } from "@convex-dev/react-query";
import { api } from "@repo/backend/api";
import {
	type ModelChoice,
	type ProviderOption,
	WorkspaceModelDialog,
} from "@repo/components";
import {
	DEFAULT_PROVIDER,
	PROVIDER_CATALOG,
	PROVIDER_NAMES,
	type ProviderName,
} from "@repo/shared/providers";
import { createContext, useCallback, useContext, useState } from "react";
import { useWorkspace } from "./workspace.tsx";

const LOGOS: Record<ProviderName, string | undefined> = {
	digitalocean: undefined,
	openrouter: "openrouter",
};

const providers: ProviderOption[] = PROVIDER_NAMES.map((id) => ({
	id,
	name: PROVIDER_CATALOG[id].label,
	logo: LOGOS[id],
	models: [...PROVIDER_CATALOG[id].models],
}));

const fallback: ModelChoice = {
	provider: DEFAULT_PROVIDER,
	model: PROVIDER_CATALOG[DEFAULT_PROVIDER].models[0]?.id ?? "",
};

interface ModelPicker {
	choice: ModelChoice;
	openModelPicker: () => void;
}

const ModelPickerContext = createContext<ModelPicker | null>(null);

export function ModelPickerProvider({
	children,
}: {
	children: React.ReactNode;
}) {
	const { workspace } = useWorkspace();
	const setModel = useConvexMutation(api.workspaces.setModel);
	const [open, setOpen] = useState(false);
	const choice = workspace?.model ?? fallback;
	const openModelPicker = useCallback(() => setOpen(true), []);

	return (
		<ModelPickerContext.Provider value={{ choice, openModelPicker }}>
			{children}
			{workspace && (
				<WorkspaceModelDialog
					onOpenChange={setOpen}
					onSelect={(model) =>
						void setModel({ workspaceId: workspace._id, model })
					}
					open={open}
					providers={providers}
					value={choice}
					workspace={workspace.name}
				/>
			)}
		</ModelPickerContext.Provider>
	);
}

export function useModelPicker(): ModelPicker {
	const ctx = useContext(ModelPickerContext);
	if (!ctx) {
		throw new Error("useModelPicker must be used within a ModelPickerProvider");
	}
	return ctx;
}
