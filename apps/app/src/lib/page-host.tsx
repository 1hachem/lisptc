import { createContext, type ReactNode, useContext } from "react";
import type { PanelContent } from "./panel-ops.ts";
import { requestPanel } from "./panel-requests.ts";

export interface PageHost {
	show: (content: PanelContent) => void;
}

const PageHostContext = createContext<PageHost | null>(null);

export function PageHostProvider({
	host,
	children,
}: {
	host: PageHost;
	children: ReactNode;
}) {
	return (
		<PageHostContext.Provider value={host}>{children}</PageHostContext.Provider>
	);
}

const OPENS_A_PANEL: PageHost = { show: requestPanel };

export function usePageHost(): PageHost {
	return useContext(PageHostContext) ?? OPENS_A_PANEL;
}
