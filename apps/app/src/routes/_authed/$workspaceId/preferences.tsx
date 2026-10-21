import { createFileRoute } from "@tanstack/react-router";
import { PreferencesPage } from "../../../components/preferences-page.tsx";

export const Route = createFileRoute("/_authed/$workspaceId/preferences")({
	component: PreferencesPage,
});
