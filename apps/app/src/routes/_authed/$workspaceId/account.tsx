import { createFileRoute } from "@tanstack/react-router";
import { AccountPage } from "../../../components/account-page.tsx";

export const Route = createFileRoute("/_authed/$workspaceId/account")({
	component: AccountPage,
});
