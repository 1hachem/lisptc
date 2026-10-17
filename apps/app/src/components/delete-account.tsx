import { Input } from "@repo/ui";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useId, useState } from "react";
import { forgetUser } from "../lib/analytics.tsx";
import { useAttempt } from "../lib/attempt.ts";
import { authClient } from "../lib/auth-client.ts";

const VERIFICATION = "delete my account and all my data";

function useDeleteAccount() {
	const queryClient = useQueryClient();
	const navigate = useNavigate();
	const { failure, attempt } = useAttempt("account deletion");
	const [deleting, setDeleting] = useState(false);

	const remove = () =>
		attempt(async () => {
			setDeleting(true);
			const { error } = await authClient.deleteUser().catch((ex: unknown) => ({
				error: { message: String(ex), statusText: "" },
			}));
			if (error) {
				setDeleting(false);
				throw new Error(error.message ?? error.statusText);
			}
			queryClient.removeQueries();
			forgetUser();
			await navigate({ to: "/login", replace: true });
		});

	return { failure, deleting, remove };
}

export function DeleteAccount() {
	const { failure, deleting, remove } = useDeleteAccount();
	const [typed, setTyped] = useState("");
	const inputId = useId();
	const verified = typed.trim() === VERIFICATION;

	return (
		<section className="flex flex-col gap-3 border border-red/40 p-4 text-[12px]">
			<div className="text-red">delete account</div>
			<p className="m-0 text-dim">
				This deletes your account, every workspace you own, and every session,
				memory, secret and permission in them. It cannot be undone.
			</p>
			<div className="flex flex-col gap-1.5 text-dim">
				<label htmlFor={inputId}>
					Type <span className="font-mono text-fg">{VERIFICATION}</span> to
					confirm.
				</label>
				<Input
					id={inputId}
					value={typed}
					onChange={(event) => setTyped(event.target.value)}
					onPaste={(event) => event.preventDefault()}
					autoComplete="off"
					spellCheck={false}
					disabled={deleting}
					aria-invalid={typed !== "" && !verified}
					className="rounded-none border-bg2 font-mono text-[12px]"
				/>
			</div>
			<div className="flex items-center gap-3">
				<button
					type="button"
					disabled={!verified || deleting}
					onClick={remove}
					className="h-control cursor-pointer border border-red/60 px-3 text-red transition-colors hover:border-red disabled:cursor-not-allowed disabled:opacity-50"
				>
					{deleting ? "deleting…" : "delete my account"}
				</button>
				{failure && <span className="text-red">{failure}</span>}
			</div>
		</section>
	);
}
