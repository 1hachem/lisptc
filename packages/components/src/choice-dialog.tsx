"use client";

import { Tick02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import {
	ModelSelector,
	ModelSelectorContent,
	ModelSelectorEmpty,
	ModelSelectorGroup,
	ModelSelectorInput,
	ModelSelectorItem,
	ModelSelectorList,
	ModelSelectorName,
} from "@repo/ui";
import type { ReactNode } from "react";

export type Choice = {
	id: string;
	name: string;
	keywords?: string[];
	preview?: ReactNode;
};

export type ChoiceGroup = { heading?: string; choices: Choice[] };

export function ChoiceDialog({
	title,
	noun,
	groups,
	value,
	onSelect,
	open,
	onOpenChange,
}: {
	title: string;
	noun: string;
	groups: ChoiceGroup[];
	value: string;
	onSelect: (id: string) => void;
	open: boolean;
	onOpenChange: (open: boolean) => void;
}) {
	return (
		<ModelSelector onOpenChange={onOpenChange} open={open}>
			<ModelSelectorContent className="sm:max-w-dialog-sm" title={title}>
				<ModelSelectorInput placeholder={`Search ${noun}s`} />
				<ModelSelectorList>
					<ModelSelectorEmpty>{`No ${noun} matches.`}</ModelSelectorEmpty>
					{groups
						.filter((group) => group.choices.length > 0)
						.map((group) => (
							<ModelSelectorGroup
								heading={group.heading}
								key={group.heading ?? "all"}
							>
								{group.choices.map((choice) => {
									const chosen = choice.id === value;
									return (
										<ModelSelectorItem
											data-chosen={chosen || undefined}
											key={choice.id}
											keywords={[choice.name, ...(choice.keywords ?? [])]}
											onSelect={() => {
												if (!chosen) onSelect(choice.id);
												onOpenChange(false);
											}}
											value={choice.id}
										>
											{choice.preview}
											<ModelSelectorName className="text-xs">
												{choice.name}
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
		</ModelSelector>
	);
}
