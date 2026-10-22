import { convexQuery, useConvexMutation } from "@convex-dev/react-query";
import { api } from "@repo/backend/api";
import type { Id } from "@repo/backend/dataModel";
import {
	type TreeCheck,
	TreeFile,
	TreeFilter,
	TreeFolder,
	TreePending,
} from "@repo/components";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { type ReactNode, useRef, useState } from "react";
import { restoreFailure } from "../lib/bin.ts";
import { knowledgeIcon } from "../lib/file-icons.ts";
import { searched, useSelection } from "../lib/file-list.ts";
import { useKnowledgeUpload } from "../lib/uploads.ts";
import { BulkToolbar } from "./bulk-toolbar.tsx";
import { FileMenu } from "./file-menu.tsx";
import {
	DatedListing,
	type FolderState,
	Listing,
	useLeave,
} from "./tree-listing.tsx";

export type FileFolderName = "knowledge" | "attachments" | "bin";

type StoredFile = { name: string; contentType: string | null };

type Restore<T> = {
	run: (name: string) => Promise<unknown>;
	label: (file: T) => string;
};

function newestFirst<T>(
	found: T[] | undefined,
	at: ((file: T) => number) | undefined,
): T[] | undefined {
	if (at === undefined || found === undefined) return found;
	return [...found].sort((a, b) => at(b) - at(a));
}

function FileRow<T extends StoredFile>({
	file,
	workspaceId,
	folder,
	current,
	check,
	confirm,
	restore,
	leave,
	onDelete,
}: {
	file: T;
	workspaceId: Id<"workspaces">;
	folder: FileFolderName;
	current: string | undefined;
	check: TreeCheck | undefined;
	confirm: string;
	restore?: Restore<T>;
	leave: ReturnType<typeof useLeave>;
	onDelete: (name: string) => Promise<unknown>;
}) {
	const open = current === file.name;
	return (
		<TreeFile
			name={file.name}
			icon={knowledgeIcon(file.name, file.contentType)}
			depth={1}
			selected={open}
			check={check}
			trailing={
				<FileMenu
					name={file.name}
					confirm={confirm}
					restoreLabel={restore?.label(file)}
					onRestore={
						restore &&
						(async () => {
							await restore.run(file.name);
							await leave(open);
						})
					}
					onDelete={async () => {
						await leave(open);
						await onDelete(file.name);
					}}
				/>
			}
			link={(content, className) => (
				<Link
					to={`/$workspaceId/${folder}/$name`}
					params={{ workspaceId, name: file.name }}
					className={className}
				>
					{content}
				</Link>
			)}
		/>
	);
}

function unmatched(empty: string | null, query: string): string | null {
	return empty === null || query.trim() === "" ? empty : "nothing matches";
}

function FolderListing<T>({
	items,
	at,
	empty,
	check,
	children,
}: {
	items: T[] | undefined;
	at?: (file: T) => number;
	empty: string | null;
	check: (dated: T[]) => TreeCheck;
	children: (file: T) => ReactNode;
}) {
	if (at === undefined)
		return (
			<Listing items={items} empty={empty}>
				{children}
			</Listing>
		);
	return (
		<DatedListing items={items} at={at} empty={empty} check={check}>
			{children}
		</DatedListing>
	);
}

function FileFolder<T extends StoredFile>({
	workspaceId,
	current,
	folder,
	files,
	at,
	search,
	empty,
	served,
	confirm,
	onDelete,
	onDeleteAll,
	restore,
	onCreate,
	createLabel,
	children,
}: {
	workspaceId: Id<"workspaces">;
	current: string | undefined;
	folder: FolderState<FileFolderName>;
	files: T[] | undefined;
	at?: (file: T) => number;
	search: string;
	empty: string | null;
	served: (name: string) => Promise<{ url: string | null } | null>;
	confirm: { one: string; all: string };
	onDelete: (name: string) => Promise<unknown>;
	onDeleteAll: (names: string[]) => Promise<unknown>;
	restore?: {
		run: (name: string) => Promise<unknown>;
		label: (file: T) => string;
	};
	onCreate?: () => void;
	createLabel?: string;
	children?: ReactNode;
}) {
	const leave = useLeave(workspaceId);
	const [query, setQuery] = useState("");
	const shown = newestFirst(searched(files, query), at);
	const selection = useSelection(shown?.map((file) => file.name));
	const namesOf = (listed: T[]) => listed.map((file) => file.name);

	const row = (file: T) => (
		<FileRow
			key={file.name}
			file={file}
			workspaceId={workspaceId}
			folder={folder.name}
			current={current}
			check={selection.check(file.name)}
			confirm={confirm.one}
			restore={restore}
			leave={leave}
			onDelete={onDelete}
		/>
	);

	return (
		<TreeFolder {...folder} onCreate={onCreate} createLabel={createLabel}>
			{files !== undefined && files.length > 0 && (
				<TreeFilter
					value={query}
					onChange={setQuery}
					label={search}
					check={selection.among(namesOf(shown ?? []))}
				/>
			)}
			<BulkToolbar
				selection={selection}
				total={shown?.length ?? 0}
				folder={folder.name}
				current={current}
				leave={leave}
				served={served}
				confirm={confirm.all}
				onDelete={onDeleteAll}
				onRestore={restore?.run}
			/>
			<FolderListing
				items={shown}
				at={at}
				empty={unmatched(empty, query)}
				check={(dated) => selection.among(namesOf(dated))}
			>
				{row}
			</FolderListing>
			{children}
		</TreeFolder>
	);
}

export type FolderProps<Name extends FileFolderName> = {
	workspaceId: Id<"workspaces">;
	current: string | undefined;
	folder: FolderState<Name>;
};

function useStored(
	workspaceId: Id<"workspaces">,
	folder: "knowledge" | "attachments",
	enabled: boolean,
) {
	const { data: files } = useQuery({
		...convexQuery(api.files.list, { workspaceId, folder }),
		enabled,
	});
	const queryClient = useQueryClient();
	const remove = useConvexMutation(api.files.remove);
	const removeMany = useConvexMutation(api.files.removeMany);
	return {
		files,
		served: (name: string) =>
			queryClient.fetchQuery(
				convexQuery(api.files.get, { workspaceId, folder, name }),
			),
		onDelete: (name: string) => remove({ workspaceId, folder, name }),
		onDeleteAll: (names: string[]) =>
			removeMany({ workspaceId, folder, names }),
	};
}

export function KnowledgeFolder({
	workspaceId,
	current,
	folder,
}: FolderProps<"knowledge">) {
	const stored = useStored(workspaceId, "knowledge", true);
	const picker = useRef<HTMLInputElement>(null);
	const { upload, uploading, failures } = useKnowledgeUpload(workspaceId);

	return (
		<>
			<input
				ref={picker}
				type="file"
				multiple
				hidden
				onChange={(event) => {
					const picked = event.target.files;
					if (picked === null || picked.length === 0) return;
					if (!folder.open) folder.onToggle();
					void upload([...picked]);
					event.target.value = "";
				}}
			/>
			<FileFolder
				workspaceId={workspaceId}
				current={current}
				folder={folder}
				{...stored}
				search="search knowledge"
				empty={uploading.length > 0 ? null : "no knowledge yet"}
				confirm={{ one: "move it to the bin?", all: "move them to the bin?" }}
				onCreate={() => picker.current?.click()}
				createLabel="upload to knowledge/"
			>
				{uploading.map((name) => (
					<TreePending key={name} name={name} label="uploading" depth={1} />
				))}
				{failures.map((failure) => (
					<div key={failure} className="py-1 pl-9 text-red">
						{failure}
					</div>
				))}
			</FileFolder>
		</>
	);
}

export function AttachmentsFolder({
	workspaceId,
	current,
	folder,
}: FolderProps<"attachments">) {
	const stored = useStored(workspaceId, "attachments", folder.open);

	return (
		<FileFolder
			workspaceId={workspaceId}
			current={current}
			folder={folder}
			{...stored}
			at={(file) => file.addedAt}
			search="search attachments"
			empty="nothing attached lately"
			confirm={{ one: "move it to the bin?", all: "move them to the bin?" }}
		/>
	);
}

export function BinFolder({
	workspaceId,
	current,
	folder,
}: FolderProps<"bin">) {
	const { data: files } = useQuery({
		...convexQuery(api.bin.list, { workspaceId }),
		enabled: folder.open,
	});
	const queryClient = useQueryClient();
	const restore = useConvexMutation(api.bin.restore);
	const remove = useConvexMutation(api.bin.remove);
	const removeMany = useConvexMutation(api.bin.removeMany);

	return (
		<FileFolder
			workspaceId={workspaceId}
			current={current}
			folder={folder}
			files={files}
			at={(file) => file.binnedAt}
			search="search the bin"
			empty="the bin is empty"
			served={(name) =>
				queryClient.fetchQuery(convexQuery(api.bin.get, { workspaceId, name }))
			}
			confirm={{
				one: "delete this file for good?",
				all: "delete them for good?",
			}}
			onDelete={(name) => remove({ workspaceId, name })}
			onDeleteAll={(names) => removeMany({ workspaceId, names })}
			restore={{
				run: async (name) => {
					const restored = await restore({ workspaceId, name });
					if ("refused" in restored)
						throw new Error(restoreFailure(restored.refused));
				},
				label: (file) => `restore to ${file.from}`,
			}}
		/>
	);
}
