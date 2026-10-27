import { useConvexMutation } from "@convex-dev/react-query";
import { api } from "@repo/backend/api";
import type { Id } from "@repo/backend/dataModel";
import { type Choice, ChoiceDialog } from "@repo/components/choice-dialog.tsx";
import {
	createContext,
	useCallback,
	useContext,
	useMemo,
	useState,
} from "react";
import { reportIssue } from "./analytics.tsx";
import { useChatStore } from "./chat.tsx";
import { forkChoices } from "./fork-choices.ts";

export interface ForkPicker {
	openForkPicker: () => void;
}

const ForkPickerContext = createContext<ForkPicker | null>(null);

export function ForkPickerProvider({
	onForked,
	children,
}: {
	onForked: (chatId: Id<"chats">) => void;
	children: React.ReactNode;
}) {
	const store = useChatStore();
	const fork = useConvexMutation(api.chats.fork);
	const [choices, setChoices] = useState<Choice[] | null>(null);

	const openForkPicker = useCallback(() => {
		const { chatId, saved } = store.getState();
		if (chatId !== null) setChoices(forkChoices(saved));
	}, [store]);

	const forkAt = useCallback(
		async (messageId: string) => {
			const { chatId, fail } = store.getState();
			if (chatId === null) return;
			try {
				const forked = await fork({ chatId, messageId });
				onForked(forked);
			} catch (ex) {
				reportIssue(ex, { $exception_source: "chat fork", thread_id: chatId });
				fail(
					`could not fork the chat: ${ex instanceof Error ? ex.message : String(ex)}`,
				);
			}
		},
		[store, fork, onForked],
	);

	const value = useMemo(() => ({ openForkPicker }), [openForkPicker]);

	return (
		<ForkPickerContext.Provider value={value}>
			{children}
			<ChoiceDialog
				groups={[{ heading: "Fork the chat after", choices: choices ?? [] }]}
				noun="message"
				onOpenChange={(open) => {
					if (!open) setChoices(null);
				}}
				onSelect={(id) => {
					void forkAt(id);
				}}
				open={choices !== null}
				title="Revert to a message"
				value=""
			/>
		</ForkPickerContext.Provider>
	);
}

export function useForkPicker(): ForkPicker {
	const picker = useContext(ForkPickerContext);
	if (!picker)
		throw new Error("useForkPicker must be used within a ForkPickerProvider");
	return picker;
}
