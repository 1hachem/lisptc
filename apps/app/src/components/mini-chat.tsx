import {
	ArrowDown01Icon,
	ArrowUp01Icon,
	BubbleChatIcon,
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
		<div className="relative flex h-full items-center">
			<button
				type="button"
				aria-label={open ? "collapse the chat" : "expand the chat"}
				title={open ? "collapse" : "expand"}
				onClick={() => setOpen(!open)}
				className={`flex h-full cursor-pointer items-center gap-1.5 px-2.5 ${open ? "bg-bg2 text-fg" : "text-dim hover:text-fg"}`}
			>
				<HugeiconsIcon className="size-icon-sm" icon={BubbleChatIcon} />
				chat
				<HugeiconsIcon
					className="size-icon-xs"
					icon={open ? ArrowDown01Icon : ArrowUp01Icon}
				/>
			</button>
			<section
				aria-label="chat"
				hidden={!open}
				className="absolute right-0 bottom-full z-40 mb-1 w-[calc(100vw/var(--app-zoom,1)-2rem)] max-w-dialog flex-col overflow-hidden rounded-md border border-border bg-bg shadow-lg [&:not([hidden])]:flex"
			>
				<div className="flex h-control flex-none items-center gap-1 border-border border-b bg-bg1 pl-3">
					<span className="min-w-0 flex-1 text-fg">chat</span>
					<button
						type="button"
						aria-label="collapse the chat into the bar"
						title="collapse"
						onClick={() => setOpen(false)}
						className="flex h-full flex-none cursor-pointer items-center px-1.5 text-dim hover:text-fg"
					>
						<HugeiconsIcon className="size-icon-sm" icon={ArrowDown01Icon} />
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
				<div className="flex h-[calc(60vh/var(--app-zoom,1))] min-h-0 flex-col">
					{children}
				</div>
			</section>
		</div>
	);
}
