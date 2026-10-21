import {
	ArrowDown01Icon,
	ArrowUp01Icon,
	Maximize01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { type ReactNode, useState } from "react";

export function MiniChat({
	onDock,
	children,
}: {
	onDock: () => void;
	children: ReactNode;
}) {
	const [open, setOpen] = useState(true);
	return (
		<section
			aria-label="chat"
			className="fixed right-4 bottom-4 z-40 flex w-[calc(100vw/var(--app-zoom,1)-2rem)] max-w-dialog flex-col overflow-hidden rounded-md border border-border bg-bg shadow-lg"
		>
			<div className="flex h-control flex-none items-center gap-1 border-border border-b bg-bg1 pl-3">
				<button
					type="button"
					onClick={() => setOpen(!open)}
					className="flex min-w-0 flex-1 cursor-pointer items-center text-left text-fg"
				>
					chat
				</button>
				<button
					type="button"
					aria-label={open ? "collapse the chat" : "expand the chat"}
					title={open ? "collapse" : "expand"}
					onClick={() => setOpen(!open)}
					className="flex h-full flex-none cursor-pointer items-center px-1.5 text-dim hover:text-fg"
				>
					<HugeiconsIcon
						className="size-icon-sm"
						icon={open ? ArrowDown01Icon : ArrowUp01Icon}
					/>
				</button>
				<button
					type="button"
					aria-label="put the chat back in the layout"
					title="maximize"
					onClick={onDock}
					className="flex h-full flex-none cursor-pointer items-center px-1.5 pr-2 text-dim hover:text-fg"
				>
					<HugeiconsIcon className="size-icon-sm" icon={Maximize01Icon} />
				</button>
			</div>
			<div
				className={
					open
						? "flex h-[calc(60vh/var(--app-zoom,1))] min-h-0 flex-col"
						: "hidden"
				}
			>
				{children}
			</div>
		</section>
	);
}
