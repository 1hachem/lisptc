import { createContext, type ReactNode, useContext } from "react";
import type { SideTrace } from "./panel-ops.ts";

export interface SideTraceControl {
	trace: SideTrace;
	show: (turn?: string) => void;
	toggle: () => void;
}

const SideTraceContext = createContext<SideTraceControl | null>(null);

export function SideTraceProvider({
	control,
	children,
}: {
	control: SideTraceControl;
	children: ReactNode;
}) {
	return (
		<SideTraceContext.Provider value={control}>
			{children}
		</SideTraceContext.Provider>
	);
}

export function useSideTrace(): SideTraceControl | null {
	return useContext(SideTraceContext);
}
