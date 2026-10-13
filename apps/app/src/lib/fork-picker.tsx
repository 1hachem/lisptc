import { useConvexMutation } from "@convex-dev/react-query";
import { api } from "@repo/backend/api";
import { type Choice, ChoiceDialog } from "@repo/components/choice-dialog.tsx";
import { useNavigate } from "@tanstack/react-router";
import {
	createContext,
	useCallback,
	useContext,
	useMemo,
	useState,
} from "react";
import { useChatStore } from "./chat.tsx";
import { forkChoices } from "./fork-choices.ts";

export interface ForkPicker {
	openForkPicker: () => void;
}

const ForkPickerContext = createContext<ForkPicker | null>(null);

export function ForkPickerProvider({
	children,
}: {
	children: React.ReactNode;
}) {
	const store = useChatStore();
	const navigate = useNavigate();
	const fork = useConvexMutation(api.chats.fork);
	const [choices, setChoices] = useState<Choice[] | null>(null);

	const openForkPicker = useCallback(() => {
		const { chatId, messages } = store.getState();
		if (chatId !== null) setChoices(forkChoices(messages));
	}, [store]);

	const forkAt = useCallback(
		async (messageId: string) => {
			const { chatId, workspaceId } = store.getState();
			if (chatId === null) return;
			const forked = await fork({ chatId, messageId });
			await navigate({
				to: "/$workspaceId/$chatId",
				params: { workspaceId, chatId: forked },
			});
		},
		[store, fork, navigate],
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
