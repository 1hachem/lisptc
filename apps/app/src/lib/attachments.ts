import { useCallback, useEffect, useRef, useState } from "react";

export type Upload =
	| { state: "uploading" }
	| { state: "done"; name: string }
	| { state: "failed"; reason: string };

export interface Attachment {
	id: string;
	file: File;
	upload: Upload;
}

export type UploadFile = (file: File) => Promise<string>;

export type DiscardUpload = (name: string) => void;

function reasonOf(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

export function attachedNames(items: readonly Attachment[]): string[] {
	return items.flatMap(({ upload }) =>
		upload.state === "done" ? [upload.name] : [],
	);
}

export function blockedSend(items: readonly Attachment[]): string | null {
	if (items.some(({ upload }) => upload.state === "uploading"))
		return "still uploading, sends once the files are in";
	if (items.some(({ upload }) => upload.state === "failed"))
		return "remove the files that failed to upload";
	return null;
}

export function useAttachments(upload?: UploadFile, discard?: DiscardUpload) {
	const [items, setItems] = useState<Attachment[]>([]);
	const gone = useRef(new Set<string>());
	const live = useRef(true);
	useEffect(
		() => () => {
			live.current = false;
		},
		[],
	);

	const settle = useCallback(
		(id: string, next: Upload) => {
			if (gone.current.has(id) || !live.current) {
				if (next.state === "done") discard?.(next.name);
				return;
			}
			setItems((prev) =>
				prev.map((item) => (item.id === id ? { ...item, upload: next } : item)),
			);
		},
		[discard],
	);

	const add = useCallback(
		(files: readonly File[]) => {
			if (!upload || files.length === 0) return;
			const added: Attachment[] = files.map((file) => ({
				id: crypto.randomUUID(),
				file,
				upload: { state: "uploading" },
			}));
			setItems((prev) => [...prev, ...added]);
			for (const { id, file } of added)
				upload(file).then(
					(name) => settle(id, { state: "done", name }),
					(error: unknown) =>
						settle(id, { state: "failed", reason: reasonOf(error) }),
				);
		},
		[upload, settle],
	);

	const remove = useCallback(
		(id: string) => {
			gone.current.add(id);
			const item = items.find((candidate) => candidate.id === id);
			if (item?.upload.state === "done") discard?.(item.upload.name);
			setItems((prev) => prev.filter((candidate) => candidate.id !== id));
		},
		[items, discard],
	);

	const clear = useCallback(() => setItems([]), []);

	return { items, add, remove, clear, enabled: upload !== undefined };
}
