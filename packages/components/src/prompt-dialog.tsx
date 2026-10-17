"use client";

import { ChoiceDialog } from "./choice-dialog.tsx";

export function PromptDialog({
	prompts,
	onSelect,
	open,
	onOpenChange,
}: {
	prompts: string[];
	onSelect: (prompt: string) => void;
	open: boolean;
	onOpenChange: (open: boolean) => void;
}) {
	return (
		<ChoiceDialog
			groups={[
				{
					choices: prompts.map((prompt, i) => ({
						id: `prompt-${i}`,
						name: prompt.replace(/\s+/g, " "),
					})),
				},
			]}
			noun="prompt"
			onOpenChange={onOpenChange}
			onSelect={(id) => {
				const prompt = prompts[Number(id.slice("prompt-".length))];
				if (prompt !== undefined) onSelect(prompt);
			}}
			open={open}
			title="Prompts"
			value=""
		/>
	);
}
