"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState, useTransition } from "react";
import { refresh } from "@/app/actions.ts";

const WATCH_MS = 15_000;
const ANALYSE_MS = 600_000;

export function Live({ generated, head }: { generated: number; head: string }) {
	const router = useRouter();
	const [age, setAge] = useState(0);
	const [failed, setFailed] = useState<string | null>(null);
	const [pending, start] = useTransition();

	const recompute = useCallback(() => {
		start(async () => {
			const done = await refresh();
			setFailed(
				done.failed.length === 0
					? null
					: done.failed.map((one) => `${one.what}: ${one.why}`).join(" · "),
			);
			router.refresh();
		});
	}, [router]);

	useEffect(() => {
		setAge(0);
		const tick = setInterval(
			() => setAge(Math.round((Date.now() - generated) / 1000)),
			1000,
		);
		const watch = setInterval(() => router.refresh(), WATCH_MS);
		return () => {
			clearInterval(tick);
			clearInterval(watch);
		};
	}, [generated, router]);

	useEffect(() => {
		const poll = setInterval(recompute, ANALYSE_MS);
		return () => clearInterval(poll);
	}, [recompute]);

	return (
		<span className="flex items-center gap-2">
			<button
				className="border border-bg2 px-2 py-0.5 text-[11.5px] text-dim tabular-nums transition-colors hover:border-dim/50 hover:text-fg disabled:opacity-60"
				disabled={pending}
				onClick={recompute}
				title="re-run the analysis and reload every view"
				type="button"
			>
				{pending
					? "analysing…"
					: `${head.slice(0, 7)} · read ${age}s ago · refresh`}
			</button>
			{failed === null ? null : (
				<span
					className="max-w-[40ch] truncate text-[11px]"
					style={{ color: "var(--crit)" }}
					title={failed}
				>
					{failed}
				</span>
			)}
		</span>
	);
}
