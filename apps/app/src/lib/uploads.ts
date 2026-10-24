import { useConvexMutation } from "@convex-dev/react-query";
import { api } from "@repo/backend/api";
import type { Id } from "@repo/backend/dataModel";
import { MAX_KNOWLEDGE_BYTES } from "@repo/backend/limits";
import { type StoreFolder, sanitizeFileName } from "@repo/shared/files";
import { ConvexError } from "convex/values";
import { useCallback, useState } from "react";
import { reportIssue } from "./analytics.tsx";

const UPLOAD_FAILURES: Record<string, string> = {
	BAD_KNOWLEDGE_NAME: "the name cannot be used for a file",
	FILE_TOO_LARGE: `over the ${MAX_KNOWLEDGE_BYTES / 1_048_576} MB limit`,
	TOO_MANY_FILES: "the folder is full",
	FORBIDDEN: "no access to this workspace",
};

function uploadFailure(name: string, error: unknown): string {
	const code =
		error instanceof ConvexError &&
		typeof error.data === "object" &&
		error.data !== null &&
		"code" in error.data
			? String(error.data.code)
			: undefined;
	const reason =
		(code !== undefined && Object.hasOwn(UPLOAD_FAILURES, code)
			? UPLOAD_FAILURES[code]
			: undefined) ??
		(error instanceof Error ? error.message : "unknown error");
	return `${name} not uploaded: ${reason}`;
}

function storedName(file: File): string {
	const name = sanitizeFileName(file.name);
	if (name === null) throw new ConvexError({ code: "BAD_KNOWLEDGE_NAME" });
	return name;
}

async function stored(url: string, file: File): Promise<Id<"_storage">> {
	if (file.size > MAX_KNOWLEDGE_BYTES)
		throw new ConvexError({ code: "FILE_TOO_LARGE" });
	const response = await fetch(url, {
		method: "POST",
		headers: { "Content-Type": file.type || "application/octet-stream" },
		body: file,
	});
	if (!response.ok) throw new Error(`upload failed (${response.status})`);
	const { storageId } = (await response.json()) as {
		storageId: Id<"_storage">;
	};
	return storageId;
}

function useFileUpload(
	workspaceId: Id<"workspaces">,
	folder: StoreFolder,
): (file: File) => Promise<string> {
	const uploadUrl = useConvexMutation(api.files.uploadUrl);
	const add = useConvexMutation(api.files.add);

	return useCallback(
		async (file: File): Promise<string> => {
			try {
				const name = storedName(file);
				const storageId = await stored(await uploadUrl({ workspaceId }), file);
				const added = await add({
					workspaceId,
					folder,
					name,
					storageId,
					contentType: file.type,
				});
				if ("refused" in added) throw new ConvexError({ code: added.refused });
				return added.name;
			} catch (error) {
				throw new Error(uploadFailure(file.name, error));
			}
		},
		[uploadUrl, add, workspaceId, folder],
	);
}

export function useAttachmentUpload(workspaceId: Id<"workspaces">) {
	const upload = useFileUpload(workspaceId, "attachments");
	const remove = useConvexMutation(api.files.discard);

	const discard = useCallback(
		(name: string) => {
			remove({ workspaceId, folder: "attachments", name }).catch(
				(ex: unknown) => {
					reportIssue(ex, { $exception_source: "attachment discard" });
					console.warn("attachment discard failed:", ex);
				},
			);
		},
		[remove, workspaceId],
	);

	return { upload, discard };
}

export function useKnowledgeUpload(workspaceId: Id<"workspaces">) {
	const uploadOne = useFileUpload(workspaceId, "knowledge");
	const [uploading, setUploading] = useState<string[]>([]);
	const [failures, setFailures] = useState<string[]>([]);

	const upload = async (files: Iterable<File>) => {
		const picked = [...files];
		setFailures([]);
		setUploading(picked.map((file) => file.name));
		const settled = await Promise.allSettled(picked.map(uploadOne));
		setUploading([]);
		setFailures(
			settled.flatMap((result) =>
				result.status === "rejected"
					? [
							result.reason instanceof Error
								? result.reason.message
								: String(result.reason),
						]
					: [],
			),
		);
	};

	return { upload, uploading, failures };
}
