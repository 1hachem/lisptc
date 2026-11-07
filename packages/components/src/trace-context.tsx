import { createContext, type ReactNode, useContext } from "react";
import { EVERY_CHANNEL, type Shown } from "./trace-channels.ts";

const ShownChannels = createContext<Shown | null>(null);

const Traced = createContext(false);

export const Revealed = createContext(false);

export function ChannelsShown({
	shown,
	children,
}: {
	shown: Shown;
	children: ReactNode;
}) {
	return (
		<ShownChannels.Provider value={shown}>
			<Traced.Provider value>{children}</Traced.Provider>
		</ShownChannels.Provider>
	);
}

export function useChannels(): Shown {
	return useContext(ShownChannels) ?? EVERY_CHANNEL;
}

export function useTraced(): boolean {
	return useContext(Traced);
}
