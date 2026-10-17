import { TaskItem, TaskList } from "@tiptap/extension-list";
import { Placeholder } from "@tiptap/extensions";
import { Markdown as MarkdownExtension } from "@tiptap/markdown";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { useEffect } from "react";
import { MARKDOWN_BODY, Markdown } from "./markdown.tsx";

const EDITOR = `${MARKDOWN_BODY} min-h-[60vh] cursor-text outline-none [&_p.is-editor-empty:first-child::before]:pointer-events-none [&_p.is-editor-empty:first-child::before]:float-left [&_p.is-editor-empty:first-child::before]:h-0 [&_p.is-editor-empty:first-child::before]:text-dim [&_p.is-editor-empty:first-child::before]:content-[attr(data-placeholder)]`;

export function MarkdownEditor({
	value,
	onChange,
	onBlur,
	label,
	placeholder,
}: {
	value: string;
	onChange: (markdown: string) => void;
	onBlur?: () => void;
	label: string;
	placeholder: string;
}) {
	const editor = useEditor({
		extensions: [
			StarterKit,
			TaskList,
			TaskItem.configure({ nested: true }),
			Placeholder.configure({ placeholder }),
			MarkdownExtension,
		],
		content: value,
		contentType: "markdown",
		immediatelyRender: false,
		editorProps: {
			attributes: { class: EDITOR, "aria-label": label },
		},
		onUpdate: ({ editor }) => onChange(editor.getMarkdown()),
		onBlur: () => onBlur?.(),
	});

	useEffect(() => {
		if (editor === null || editor.isFocused) return;
		if (editor.getMarkdown() !== value)
			editor.commands.setContent(value, { contentType: "markdown" });
	}, [editor, value]);

	if (editor === null)
		return value.trim() === "" ? (
			<div className="min-h-[60vh] text-dim">{placeholder}</div>
		) : (
			<div className="min-h-[60vh]">
				<Markdown>{value}</Markdown>
			</div>
		);
	return <EditorContent editor={editor} />;
}
