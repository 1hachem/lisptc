import { HugeiconsIcon } from "@hugeicons/react";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
	LexicalTypeaheadMenuPlugin,
	MenuOption,
	type MenuTextMatch,
} from "@lexical/react/LexicalTypeaheadMenuPlugin";
import type { StoreFolder } from "@repo/shared/files";
import { $createTextNode, type TextNode } from "lexical";
import {
	type RefObject,
	useCallback,
	useEffect,
	useMemo,
	useState,
} from "react";
import { restingIcon } from "../lib/bot-icon.ts";
import { knowledgeIcon } from "../lib/file-icons.ts";
import { typeaheadList } from "./typeahead-list.tsx";

export interface Mentionable {
	folder: StoreFolder | "sub-agents";
	name: string;
	contentType: string | null;
}

function mentionIcon({ folder, name, contentType }: Mentionable) {
	return folder === "sub-agents"
		? restingIcon()
		: knowledgeIcon(name, contentType);
}

const MENTION_QUERY = /(^|\s)@([^\s@"]*)$/;
const MAX_SHOWN = 8;

export function mentionOf({ folder, name }: Mentionable): string {
	const path = `${folder}/${name}`;
	return /\s/.test(path) ? `@"${path}"` : `@${path}`;
}

export function matchingMentions(
	files: readonly Mentionable[],
	query: string,
): Mentionable[] {
	const typed = query.toLowerCase();
	return files
		.filter((file) =>
			`${file.folder}/${file.name}`.toLowerCase().includes(typed),
		)
		.slice(0, MAX_SHOWN);
}

class MentionOption extends MenuOption {
	readonly file: Mentionable;
	constructor(file: Mentionable) {
		super(`${file.folder}/${file.name}`);
		this.file = file;
	}
}

export function MentionMenuPlugin({
	files,
	host,
	active,
}: {
	files: readonly Mentionable[];
	host: RefObject<HTMLDivElement | null>;
	active: RefObject<boolean>;
}) {
	const [editor] = useLexicalComposerContext();
	const [query, setQuery] = useState<string | null>(null);
	const [open, setOpen] = useState(false);

	const options = useMemo(
		() =>
			query === null
				? []
				: matchingMentions(files, query).map((file) => new MentionOption(file)),
		[files, query],
	);

	useEffect(() => {
		active.current = open && options.length > 0;
	}, [active, open, options]);

	const triggerFn = useCallback((typed: string): MenuTextMatch | null => {
		const match = MENTION_QUERY.exec(typed);
		if (!match) return null;
		const lead = match[1] ?? "";
		return {
			leadOffset: match.index + lead.length,
			matchingString: match[2] ?? "",
			replaceableString: `@${match[2] ?? ""}`,
		};
	}, []);

	const onSelectOption = useCallback(
		(
			option: MentionOption,
			textNode: TextNode | null,
			closeMenu: () => void,
		) => {
			editor.update(() => {
				const mention = $createTextNode(`${mentionOf(option.file)} `);
				if (textNode) textNode.replace(mention);
				mention.select();
			});
			closeMenu();
		},
		[editor],
	);

	return (
		<LexicalTypeaheadMenuPlugin<MentionOption>
			options={options}
			triggerFn={triggerFn}
			onQueryChange={setQuery}
			onSelectOption={onSelectOption}
			onOpen={() => setOpen(true)}
			onClose={() => setOpen(false)}
			anchorClassName="hidden!"
			menuRenderFn={(_anchor, state) =>
				typeaheadList(
					host,
					options,
					state,
					(option) => (
						<>
							<HugeiconsIcon
								icon={mentionIcon(option.file)}
								className="size-icon-sm flex-none text-dim"
							/>
							<span className="min-w-0 flex-1 truncate text-fg">
								{option.file.name}
							</span>
							<span className="flex-none text-[12px] text-dim">
								{option.file.folder}/
							</span>
						</>
					),
					"center",
				)
			}
		/>
	);
}
