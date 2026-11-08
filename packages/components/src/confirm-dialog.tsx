"use client";

import {
	Button,
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@repo/ui";

export function ConfirmDialog({
	open,
	onOpenChange,
	title,
	description,
	confirm,
	destructive = false,
	onConfirm,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	title: string;
	description: string;
	confirm: string;
	destructive?: boolean;
	onConfirm: () => void;
}) {
	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-dialog-sm">
				<DialogHeader>
					<DialogTitle>{title}</DialogTitle>
					<DialogDescription>{description}</DialogDescription>
				</DialogHeader>
				<DialogFooter>
					<Button
						size="sm"
						variant="outline"
						onClick={() => onOpenChange(false)}
					>
						cancel
					</Button>
					<Button
						size="sm"
						variant={destructive ? "destructive" : "default"}
						onClick={() => {
							onOpenChange(false);
							onConfirm();
						}}
					>
						{confirm}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
