import type { ReactNode } from "react";
import { LispText } from "./lisp-text.tsx";

export function UserLine({
	text,
	mark = "›",
	tone = "text-dim",
	title,
}: {
	text: string;
	mark?: ReactNode;
	tone?: string;
	title?: string;
}) {
	return (
		<div title={title} className="flex min-w-0 flex-1 gap-1">
			<span className={`select-none ${tone}`}>{mark}</span>
			<div className="min-w-0 whitespace-pre-wrap break-words">
				<LispText>{text}</LispText>
			</div>
		</div>
	);
}
