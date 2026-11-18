import { createContext, type ReactNode, useContext } from "react";
import { EVERY_LANE, type Shown } from "./trace-lanes.ts";

const ShownLanes = createContext<Shown | null>(null);

const Traced = createContext(false);

export const Revealed = createContext(false);

export function LanesShown({
	shown,
	children,
}: {
	shown: Shown;
	children: ReactNode;
}) {
	return (
		<ShownLanes.Provider value={shown}>
			<Traced.Provider value>{children}</Traced.Provider>
		</ShownLanes.Provider>
	);
}

export function useLanes(): Shown {
	return useContext(ShownLanes) ?? EVERY_LANE;
}

export function useTraced(): boolean {
	return useContext(Traced);
}
