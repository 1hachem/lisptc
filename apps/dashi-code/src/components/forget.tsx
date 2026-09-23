"use client";

import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@repo/ui/components/ui/dialog.tsx";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { forget } from "@/app/actions.ts";

const WHY =
	"The snapshot is deleted from the store for good, and anything comparing against it stops working. The repo itself is untouched.";

export function Forget({ file, taken }: { file: string; taken: string }) {
	const router = useRouter();
	const [open, setOpen] = useState(false);
	const [failed, setFailed] = useState<string | null>(null);
	const [pending, start] = useTransition();

	const confirm = () => {
		start(async () => {
			try {
				await forget(file);
				setOpen(false);
				router.refresh();
			} catch (err) {
				setFailed(err instanceof Error ? err.message : String(err));
			}
		});
	};

	return (
		<>
			<button
				className="text-dim transition-colors hover:text-red"
				onClick={() => {
					setFailed(null);
					setOpen(true);
				}}
				type="button"
			>
				remove
			</button>

			<Dialog onOpenChange={setOpen} open={open}>
				<DialogContent className="border-bg2 bg-bg1">
					<DialogHeader>
						<DialogTitle className="text-[15px] text-fg">
							Remove this version?
						</DialogTitle>
						<DialogDescription className="text-[13px] text-dim">
							Taken {taken}. {WHY}
						</DialogDescription>
					</DialogHeader>
					<p className="m-0 truncate text-[11.5px] text-dim">{file}</p>
					{failed === null ? null : (
						<p className="m-0 text-[12px]" style={{ color: "var(--crit)" }}>
							{failed}
						</p>
					)}
					<DialogFooter>
						<button
							className="border border-bg2 px-3 py-1.5 text-[12px] text-dim transition-colors hover:text-fg"
							disabled={pending}
							onClick={() => setOpen(false)}
							type="button"
						>
							cancel
						</button>
						<button
							className="border border-red/60 px-3 py-1.5 text-[12px] text-red transition-colors hover:border-red disabled:opacity-60"
							disabled={pending}
							onClick={confirm}
							type="button"
						>
							{pending ? "removing…" : "remove"}
						</button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</>
	);
}
