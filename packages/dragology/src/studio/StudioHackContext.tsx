import { createContext } from "react";

export type StudioHackSettings = {
	overlayHideDistances?: boolean;
	overlayFullOpacity?: boolean;
	tightFixed?: boolean;
};

export const StudioHackContext = createContext<StudioHackSettings>({});
