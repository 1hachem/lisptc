import { DropdownMenuItem } from "@repo/ui";
import { useState } from "react";

export function ConfirmItem({
	label,
	confirm,
	onConfirm,
	className,
}: {
	label: string;
	confirm: string;
	onConfirm: () => void;
	className?: string;
}) {
	const [armed, setArmed] = useState(false);

	return (
		<DropdownMenuItem
			onSelect={(event) => {
				if (!armed) {
					event.preventDefault();
					setArmed(true);
					return;
				}
				onConfirm();
			}}
			className={className}
		>
			{armed ? confirm : label}
		</DropdownMenuItem>
	);
}
