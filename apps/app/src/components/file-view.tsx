import { contentRegion } from "@repo/ui-catalog";
import type { ReactNode } from "react";
import type { OpenFile } from "../lib/files.ts";
import { LispSource } from "./lisp-text.tsx";

const LAYOUT = {
	scroll: { outer: "overflow-y-auto", inner: "" },
	fill: {
		outer: "flex flex-col overflow-hidden pb-3",
		inner: "min-h-0 flex-1",
	},
};

function FileBody({
	file,
	missing,
	body,
}: {
	file: OpenFile | undefined;
	missing?: string;
	body?: ReactNode;
}) {
	if (file === undefined)
		return <div className="text-dim">{missing ?? "loading…"}</div>;
	if (body !== undefined) return body;
	if (file.source.trim() === "") return <div className="text-dim">empty</div>;
	return (
		<pre className="whitespace-pre-wrap break-words font-mono">
			<LispSource>{file.source}</LispSource>
		</pre>
	);
}

export function FileView({
	file,
	missing,
	actions,
	body,
	fill = false,
}: {
	file: OpenFile | undefined;
	missing?: string;
	actions?: ReactNode;
	body?: ReactNode;
	fill?: boolean;
}) {
	const layout = fill ? LAYOUT.fill : LAYOUT.scroll;
	return (
		<div
			{...contentRegion}
			className={`min-h-0 flex-1 [scrollbar-gutter:stable_both-edges] px-8 pt-6 pb-7 ${layout.outer}`}
		>
			<div
				className={`mx-auto flex w-full max-w-[680px] flex-col gap-3 ${layout.inner}`}
			>
				<div className="flex items-baseline gap-3 font-mono text-[11.5px] text-dim">
					<span className="min-w-0 flex-1 truncate">{file?.path ?? ""}</span>
					{actions}
				</div>
				<FileBody file={file} missing={missing} body={body} />
			</div>
		</div>
	);
}
