import Link from "next/link";
import { spans, wholeSpan } from "@/lib/span.ts";

export function SpanPicker({ at, current }: { at: string; current: string }) {
	return (
		<nav className="flex flex-wrap items-center gap-px bg-bg2">
			{spans.map((span) => (
				<Link
					className={`px-2 py-0.5 text-[11.5px] ${
						span.id === current
							? "bg-bg text-fg"
							: "bg-bg1 text-dim hover:text-fg"
					}`}
					href={span.id === wholeSpan.id ? at : `${at}?span=${span.id}`}
					key={span.id}
				>
					{span.label}
				</Link>
			))}
		</nav>
	);
}
