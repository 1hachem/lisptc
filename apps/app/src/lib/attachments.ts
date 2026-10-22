import { useCallback, useEffect, useRef, useState } from "react";
import type { Flash } from "./notice.ts";

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

export interface FileTransfer {
	upload: UploadFile;
	discard?: DiscardUpload;
}

export type SubmitMessage = (
	text: string,
	attached: string[],
) => boolean | undefined | Promise<boolean | undefined>;

const NOT_SENT = "not sent, the message is back in the input";

function reasonOf(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function attachedNames(items: readonly Attachment[]): string[] {
	return items.flatMap(({ upload }) =>
		upload.state === "done" ? [upload.name] : [],
	);
}

function blockedSend(
	items: readonly Attachment[],
	streaming = false,
): string | null {
	if (streaming && items.length > 0)
		return "files go with the next message, once this reply ends";
	if (items.some(({ upload }) => upload.state === "uploading"))
		return "still uploading, sends once the files are in";
	return null;
}

function dropFailed(count: number): string {
	return count === 1
		? "a file failed to upload, press enter again to remove it and send"
		: "files failed to upload, press enter again to remove them and send";
}

export function useAttachments(upload?: UploadFile, discard?: DiscardUpload) {
	const [items, setItems] = useState<Attachment[]>([]);
	const gone = useRef(new Set<string>());
	const live = useRef(true);
	const held = useRef(items);
	held.current = items;
	const discardOnLeave = useRef(discard);
	discardOnLeave.current = discard;
	useEffect(() => {
		live.current = true;
		return () => {
			live.current = false;
			for (const name of attachedNames(held.current))
				discardOnLeave.current?.(name);
		};
	}, []);

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

	const clear = useCallback(() => {
		held.current = [];
		setItems([]);
	}, []);

	const restore = useCallback(
		(back: readonly Attachment[]) => {
			if (!live.current) {
				for (const name of attachedNames(back)) discard?.(name);
				return;
			}
			setItems((prev) => [...back, ...prev]);
		},
		[discard],
	);

	return { items, add, remove, clear, restore, enabled: upload !== undefined };
}

export function useAttachedSend({
	onSubmit,
	flash,
	files,
	streaming,
	held,
}: {
	onSubmit: SubmitMessage;
	flash: Flash;
	files?: FileTransfer;
	streaming: boolean;
	held?: string;
}) {
	const attachments = useAttachments(files?.upload, files?.discard);
	const dropping = useRef<string | null>(null);
	const submit = useCallback(
		(text: string): false | Promise<boolean> => {
			const blocked = held ?? blockedSend(attachments.items, streaming);
			const failed = attachments.items.flatMap(({ id, upload }) =>
				upload.state === "failed" ? [id] : [],
			);
			const warned = failed.join(" ");
			const confirmed = failed.length > 0 && dropping.current === warned;
			dropping.current =
				blocked === null && failed.length > 0 && !confirmed ? warned : null;
			if (blocked !== null || dropping.current !== null) {
				flash(blocked ?? dropFailed(failed.length));
				return false;
			}
			const sending = attachments.items.filter(
				({ upload }) => upload.state !== "failed",
			);
			attachments.clear();
			return new Promise<unknown>((resolve) =>
				resolve(onSubmit(text, attachedNames(sending))),
			)
				.then(
					(sent) => sent !== false,
					() => false,
				)
				.then((sent) => {
					if (!sent) {
						attachments.restore(sending);
						flash(NOT_SENT);
					}
					return sent;
				});
		},
		[attachments, onSubmit, flash, streaming, held],
	);
	return { attachments, submit };
}
