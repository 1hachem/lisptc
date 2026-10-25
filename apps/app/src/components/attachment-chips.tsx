import {
	Attachment01Icon,
	Cancel01Icon,
	Loading03Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { cn } from "@repo/ui";
import type { RefObject } from "react";
import type { Attachment } from "../lib/attachments.ts";
import { knowledgeIcon } from "../lib/file-icons.ts";

export function AttachAction({
	onClick,
	disabled,
}: {
	onClick: () => void;
	disabled?: boolean;
}) {
	return (
		<button
			type="button"
			aria-label="attach"
			title="attach files"
			onClick={onClick}
			disabled={disabled}
			className={cn(
				"group flex h-auto flex-none items-center self-center rounded-none bg-bg2 px-[9px] py-px text-[11.5px]",
				disabled ? "cursor-not-allowed text-dim" : "text-dim hover:text-fg",
			)}
		>
			<span className="max-w-0 overflow-hidden whitespace-nowrap opacity-0 transition-all duration-200 ease-out group-hover:mr-[7px] group-hover:max-w-16 group-hover:opacity-100 group-focus-visible:mr-[7px] group-focus-visible:max-w-16 group-focus-visible:opacity-100">
				attach
			</span>
			<HugeiconsIcon
				icon={Attachment01Icon}
				className="size-icon-sm flex-none"
			/>
		</button>
	);
}

function ChipIcon({ item }: { item: Attachment }) {
	if (item.upload.state === "uploading")
		return (
			<HugeiconsIcon
				icon={Loading03Icon}
				className="size-icon-sm flex-none animate-spin text-dim"
			/>
		);
	return (
		<HugeiconsIcon
			icon={knowledgeIcon(item.file.name, item.file.type)}
			className={cn(
				"size-icon-sm flex-none",
				item.upload.state === "failed" ? "text-red" : "text-dim",
			)}
		/>
	);
}

export function AttachmentChips({
	items,
	onRemove,
}: {
	items: readonly Attachment[];
	onRemove: (id: string) => void;
}) {
	if (items.length === 0) return null;
	return (
		<div className="flex flex-wrap gap-1.5 border-b border-bg2 bg-bg1 px-3 py-1">
			{items.map((item) => (
				<span
					key={item.id}
					data-upload={item.upload.state}
					title={
						item.upload.state === "failed" ? item.upload.reason : undefined
					}
					className={cn(
						"flex h-control-xs min-w-0 max-w-full items-center gap-1.5 bg-bg2 px-2 text-[11.5px]",
						item.upload.state === "failed" && "text-red",
					)}
				>
					<ChipIcon item={item} />
					<span className="min-w-0 max-w-48 truncate whitespace-nowrap">
						{item.file.name}
					</span>
					<button
						type="button"
						aria-label={`remove ${item.file.name}`}
						onClick={() => onRemove(item.id)}
						className="flex flex-none items-center text-dim hover:text-red"
					>
						<HugeiconsIcon icon={Cancel01Icon} className="size-icon-xs" />
					</button>
				</span>
			))}
		</div>
	);
}

export function FilePicker({
	picker,
	onPick,
}: {
	picker: RefObject<HTMLInputElement | null>;
	onPick: (files: File[]) => void;
}) {
	return (
		<input
			ref={picker}
			type="file"
			multiple
			hidden
			onChange={(event) => {
				const picked = event.target.files;
				if (picked !== null) onPick([...picked]);
				event.target.value = "";
			}}
		/>
	);
}
