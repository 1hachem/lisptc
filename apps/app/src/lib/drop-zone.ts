import { type ClipboardEvent, type DragEvent, useState } from "react";

export function useDropZone(add: (files: File[]) => void, disabled?: boolean) {
	const [over, setOver] = useState(false);
	const carriesFiles = (event: DragEvent) =>
		!disabled && event.dataTransfer.types.includes("Files");
	return {
		over,
		zone: {
			onDragOver: (event: DragEvent) => {
				if (!carriesFiles(event)) return;
				event.preventDefault();
				setOver(true);
			},
			onDragLeave: (event: DragEvent) => {
				if (event.currentTarget.contains(event.relatedTarget as Node | null))
					return;
				setOver(false);
			},
			onDrop: (event: DragEvent) => {
				setOver(false);
				if (!carriesFiles(event)) return;
				event.preventDefault();
				add([...event.dataTransfer.files]);
			},
			onPaste: (event: ClipboardEvent) => {
				if (disabled) return;
				const images = [...event.clipboardData.files].filter((file) =>
					file.type.startsWith("image/"),
				);
				if (images.length === 0) return;
				event.preventDefault();
				add(images);
			},
		},
	};
}
