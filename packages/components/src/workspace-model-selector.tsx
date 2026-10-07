"use client";

import { ArrowDown01Icon, Tick02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import {
	Button,
	ModelSelector,
	ModelSelectorContent,
	ModelSelectorEmpty,
	ModelSelectorGroup,
	ModelSelectorInput,
	ModelSelectorItem,
	ModelSelectorList,
	ModelSelectorLogo,
	ModelSelectorName,
	ModelSelectorTrigger,
} from "@repo/ui";
import { type ReactNode, useState } from "react";

export type ModelOption = { id: string; name: string };

export type ProviderOption = {
	id: string;
	name: string;
	logo?: string;
	models: ModelOption[];
};

export type ModelChoice = { provider: string; model: string };

type Choosing = {
	workspace: string;
	providers: ProviderOption[];
	value: ModelChoice;
	onSelect: (choice: ModelChoice) => Promise<void> | void;
};

function ModelChoices({
	workspace,
	providers,
	value,
	onChoose,
}: Omit<Choosing, "onSelect"> & {
	onChoose: (choice: ModelChoice) => Promise<void>;
}) {
	const [failed, setFailed] = useState(false);
	const choose = (choice: ModelChoice) => {
		setFailed(false);
		onChoose(choice).catch(() => setFailed(true));
	};
	return (
		<ModelSelectorContent
			className="sm:max-w-dialog-sm"
			title={`Model for ${workspace}`}
		>
			<ModelSelectorInput placeholder="Search models" />
			{failed && (
				<p className="px-3 py-2 text-destructive text-xs">
					The model was not saved. Try again.
				</p>
			)}
			<ModelSelectorList>
				<ModelSelectorEmpty>No model matches.</ModelSelectorEmpty>
				{providers.map((p) => (
					<ModelSelectorGroup heading={p.name} key={p.id}>
						{p.models.map((m) => {
							const chosen = p.id === value.provider && m.id === value.model;
							return (
								<ModelSelectorItem
									data-chosen={chosen || undefined}
									key={m.id}
									keywords={[p.name]}
									onSelect={() => choose({ provider: p.id, model: m.id })}
									value={`${p.id}/${m.id}`}
								>
									{p.logo && <ModelSelectorLogo provider={p.logo} />}
									<ModelSelectorName className="text-xs">
										{m.name}
									</ModelSelectorName>
									{chosen && (
										<HugeiconsIcon
											className="ml-auto size-icon-sm"
											icon={Tick02Icon}
										/>
									)}
								</ModelSelectorItem>
							);
						})}
					</ModelSelectorGroup>
				))}
			</ModelSelectorList>
		</ModelSelectorContent>
	);
}

function chooser(
	value: ModelChoice,
	onSelect: Choosing["onSelect"],
	close: () => void,
) {
	return async (choice: ModelChoice) => {
		if (choice.provider !== value.provider || choice.model !== value.model)
			await onSelect(choice);
		close();
	};
}

export function WorkspaceModelDialog({
	open,
	onOpenChange,
	...choosing
}: Choosing & { open: boolean; onOpenChange: (open: boolean) => void }) {
	return (
		<ModelSelector onOpenChange={onOpenChange} open={open}>
			<ModelChoices
				{...choosing}
				onChoose={chooser(choosing.value, choosing.onSelect, () =>
					onOpenChange(false),
				)}
			/>
		</ModelSelector>
	);
}

export function WorkspaceModelSelector({
	disabled,
	className,
	children,
	...choosing
}: Choosing & {
	disabled?: boolean;
	className?: string;
	children?: ReactNode;
}) {
	const [open, setOpen] = useState(false);
	const provider = choosing.providers.find(
		(p) => p.id === choosing.value.provider,
	);
	const model = provider?.models.find((m) => m.id === choosing.value.model);

	return (
		<ModelSelector onOpenChange={setOpen} open={open}>
			<ModelSelectorTrigger asChild>
				{children ?? (
					<Button
						className={className}
						disabled={disabled}
						size="sm"
						variant="outline"
					>
						{provider?.logo && <ModelSelectorLogo provider={provider.logo} />}
						<ModelSelectorName>
							{model?.name ?? choosing.value.model}
						</ModelSelectorName>
						<HugeiconsIcon
							className="size-icon-sm opacity-50"
							icon={ArrowDown01Icon}
						/>
					</Button>
				)}
			</ModelSelectorTrigger>
			<ModelChoices
				{...choosing}
				onChoose={chooser(choosing.value, choosing.onSelect, () =>
					setOpen(false),
				)}
			/>
		</ModelSelector>
	);
}
