import { LispText } from "./lisp-text.tsx";

export function UserLine({ text }: { text: string }) {
	return (
		<div className="flex min-w-0 flex-1 gap-1">
			<span className="select-none text-dim">›</span>
			<div className="min-w-0 whitespace-pre-wrap break-words">
				<LispText>{text}</LispText>
			</div>
		</div>
	);
}
