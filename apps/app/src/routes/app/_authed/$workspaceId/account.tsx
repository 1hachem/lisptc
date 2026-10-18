import { convexQuery } from "@convex-dev/react-query";
import { api } from "@repo/backend/api";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { DeleteAccount } from "../../../../components/delete-account.tsx";

export const Route = createFileRoute("/app/_authed/$workspaceId/account")({
	component: AccountSettings,
});

function AccountSettings() {
	const { data: user } = useQuery(convexQuery(api.users.me, {}));

	return (
		<div className="min-h-0 flex-1 overflow-y-auto px-8 pt-6">
			<div className="mx-auto flex w-full max-w-[680px] flex-col gap-6">
				<div className="font-mono text-[11.5px] text-dim">account</div>
				<section className="flex flex-col gap-1 text-[12px]">
					<div className="text-fg">{user?.name || user?.email || "…"}</div>
					{user?.name ? <div className="text-dim">{user.email}</div> : null}
				</section>
				<DeleteAccount />
			</div>
		</div>
	);
}
