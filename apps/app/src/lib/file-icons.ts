import {
	CssFile01Icon,
	Csv01Icon,
	Doc01Icon,
	DocumentCodeIcon,
	File01Icon,
	FileArchiveIcon,
	FileAudioIcon,
	FileBracesIcon,
	FileImageIcon,
	FileTextIcon,
	FileVideoIcon,
	Gif01Icon,
	HtmlFile01Icon,
	JavaScriptIcon,
	Jpg01Icon,
	Mp301Icon,
	Pdf01Icon,
	Png01Icon,
	Ppt01Icon,
	PythonIcon,
	Rar01Icon,
	SqlIcon,
	Svg01Icon,
	ThreeDViewIcon,
	Txt01Icon,
	TypescriptIcon,
	Xls01Icon,
	Xml01Icon,
	Zip01Icon,
} from "@hugeicons/core-free-icons";
import type { IconSvgElement } from "@hugeicons/react";
import { extensionOf } from "./file-viewer.ts";

const EXTENSION_ICONS = new Map<string, IconSvgElement>([
	["pdf", Pdf01Icon],
	["doc", Doc01Icon],
	["docx", Doc01Icon],
	["odt", Doc01Icon],
	["rtf", Doc01Icon],
	["xls", Xls01Icon],
	["xlsx", Xls01Icon],
	["ods", Xls01Icon],
	["csv", Csv01Icon],
	["tsv", Csv01Icon],
	["ppt", Ppt01Icon],
	["pptx", Ppt01Icon],
	["odp", Ppt01Icon],
	["txt", Txt01Icon],
	["log", Txt01Icon],
	["md", FileTextIcon],
	["markdown", FileTextIcon],
	["json", FileBracesIcon],
	["yaml", FileBracesIcon],
	["yml", FileBracesIcon],
	["toml", FileBracesIcon],
	["xml", Xml01Icon],
	["html", HtmlFile01Icon],
	["htm", HtmlFile01Icon],
	["css", CssFile01Icon],
	["js", JavaScriptIcon],
	["mjs", JavaScriptIcon],
	["jsx", JavaScriptIcon],
	["ts", TypescriptIcon],
	["tsx", TypescriptIcon],
	["py", PythonIcon],
	["sql", SqlIcon],
	["ptc", DocumentCodeIcon],
	["jpg", Jpg01Icon],
	["jpeg", Jpg01Icon],
	["png", Png01Icon],
	["gif", Gif01Icon],
	["svg", Svg01Icon],
	["zip", Zip01Icon],
	["rar", Rar01Icon],
	["tar", FileArchiveIcon],
	["gz", FileArchiveIcon],
	["7z", FileArchiveIcon],
	["mp3", Mp301Icon],
	["stl", ThreeDViewIcon],
]);

const KIND_ICONS = new Map<string, IconSvgElement>([
	["image", FileImageIcon],
	["video", FileVideoIcon],
	["audio", FileAudioIcon],
	["text", FileTextIcon],
]);

export function knowledgeIcon(
	name: string,
	contentType: string | null,
): IconSvgElement {
	return (
		EXTENSION_ICONS.get(extensionOf(name)) ??
		KIND_ICONS.get(contentType?.split("/")[0] ?? "") ??
		File01Icon
	);
}
