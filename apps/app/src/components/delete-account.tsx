import { Input } from "@repo/ui";
import { useId, useState } from "react";
import { authClient } from "../lib/auth-client.ts";
import { useLeave } from "../lib/leave.tsx";

const VERIFICATION = "delete my account and all my data";

async function deleteUser(): Promise<void> {
	const { error } = await authClient.deleteUser();
	if (error) throw new Error(error.message ?? error.statusText);
}

export function DeleteAccount() {
	const { leaving: deleting, failure, leave } = useLeave();
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
					onClick={() => void leave(deleteUser)}
					className="h-control cursor-pointer border border-red/60 px-3 text-red transition-colors hover:border-red disabled:cursor-not-allowed disabled:opacity-50"
				>
					{deleting ? "deleting…" : "delete my account"}
				</button>
				{failure && <span className="text-red">{failure}</span>}
			</div>
		</section>
	);
}
