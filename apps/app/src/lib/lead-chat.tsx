import {
	createContext,
	type Dispatch,
	type ReactNode,
	type SetStateAction,
	useContext,
	useEffect,
	useMemo,
	useState,
} from "react";
import { type ChatStore, useChatStore } from "./chat.tsx";

interface Held {
	store: ChatStore;
}

interface LeadChat {
	held: Held | null;
	claim: Dispatch<SetStateAction<Held | null>>;
}

const LeadChatContext = createContext<LeadChat | null>(null);

export function LeadChatProvider({ children }: { children: ReactNode }) {
	const [held, claim] = useState<Held | null>(null);
	const value = useMemo(() => ({ held, claim }), [held]);
	return (
		<LeadChatContext.Provider value={value}>
			{children}
		</LeadChatContext.Provider>
	);
}

export function ClaimLead() {
	const store = useChatStore();
	const lead = useContext(LeadChatContext);
	const claim = lead?.claim;
	useEffect(() => {
		if (!claim) return;
		claim({ store });
		return () => claim((held) => (held?.store === store ? null : held));
	}, [claim, store]);
	return null;
}
