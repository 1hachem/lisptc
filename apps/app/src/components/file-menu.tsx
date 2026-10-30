import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@repo/ui";
import type { AnchorMark } from "@repo/ui-catalog";
import { useAttempt } from "../lib/attempt.ts";
import { ConfirmItem } from "./confirm-item.tsx";

const item =
	"rounded-none px-2.5 py-1 text-[11.5px] text-dim focus:bg-bg2 focus:text-fg";

export function FileMenu({
	name,
	confirm,
	onDelete,
	onRestore,
	restoreLabel = "restore",
	anchor,
}: {
	name: string;
	confirm: string;
	onDelete: () => Promise<unknown>;
	onRestore?: () => Promise<unknown>;
	restoreLabel?: string;
	anchor?: AnchorMark;
}) {
	const { failure, attempt } = useAttempt(`delete ${name}`);

	return (
		<DropdownMenu>
			<DropdownMenuTrigger
				{...anchor}
				title={failure ?? `${name} options`}
				className={`flex-none cursor-pointer px-1.5 py-0.5 ${failure ? "text-red opacity-100" : "text-dim opacity-0"} transition hover:text-fg focus:opacity-100 group-hover/row:opacity-100 data-[state=open]:opacity-100`}
			>
				⋯
			</DropdownMenuTrigger>
			<DropdownMenuContent
				align="end"
				sideOffset={2}
				className="min-w-[9rem] rounded-none border-bg2 bg-bg1 p-0 text-[11.5px] shadow-none"
			>
				{onRestore && (
					<DropdownMenuItem
						className={item}
						onSelect={() => attempt(onRestore)}
					>
						{restoreLabel}
					</DropdownMenuItem>
				)}
				<ConfirmItem
					label="delete"
					confirm={confirm}
					className={`${item} focus:text-red`}
					onConfirm={() => attempt(onDelete)}
				/>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
