import {
	ANCHOR_ATTRIBUTE,
	type AnchorId,
	CONTENT_ATTRIBUTE,
} from "@repo/ui-catalog";
import { useEffect, useSyncExternalStore } from "react";

const INTERACTIVE = [
	"button",
	"a[href]",
	'input:not([type="hidden"])',
	"select",
	"textarea",
	'[role="button"]',
	'[role="tab"]',
	'[role="checkbox"]',
	'[role="switch"]',
	'[role="separator"][tabindex]',
	'[contenteditable="true"]',
].join(", ");

const NOT_PRODUCT = [
	`[${CONTENT_ATTRIBUTE}]`,
	'[role="dialog"]',
	'[role="menu"]',
	'[role="listbox"]',
	"[data-radix-popper-content-wrapper]",
].join(", ");

const listeners = new Set<() => void>();

let observer: MutationObserver | undefined;

function changed(): void {
	for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
	listeners.add(listener);
	if (observer === undefined && typeof MutationObserver === "function") {
		observer = new MutationObserver(changed);
		observer.observe(document.body, {
			subtree: true,
			childList: true,
			attributes: true,
			attributeFilter: [ANCHOR_ATTRIBUTE, "hidden", "style", "class"],
		});
	}
	return () => {
		listeners.delete(listener);
		if (listeners.size > 0) return;
		observer?.disconnect();
		observer = undefined;
	};
}

function shown(element: Element): boolean {
	return typeof element.checkVisibility === "function"
		? element.checkVisibility()
		: element.isConnected;
}

export function anchorElement(
	id: AnchorId,
	root: ParentNode = document,
): HTMLElement | undefined {
	for (const element of root.querySelectorAll<HTMLElement>(
		`[${ANCHOR_ATTRIBUTE}="${CSS.escape(id)}"]`,
	))
		if (shown(element)) return element;
	return undefined;
}

export function useAnchorElement(
	id: AnchorId | undefined,
): HTMLElement | undefined {
	return useSyncExternalStore(
		subscribe,
		() => (id === undefined ? undefined : anchorElement(id)),
		() => undefined,
	);
}

const DRAG_WRAPPER = '[aria-roledescription="sortable"]';

export function unpointable(root: ParentNode = document): Element[] {
	return [...root.querySelectorAll(INTERACTIVE)].filter(
		(element) =>
			!element.matches(DRAG_WRAPPER) &&
			element.closest(`[${ANCHOR_ATTRIBUTE}]`) === null &&
			element.closest(NOT_PRODUCT) === null,
	);
}

const AUDIT_SETTLE_MS = 1000;

export function useUnpointableWarning(enabled: boolean): void {
	useEffect(() => {
		if (!enabled) return;
		const warned = new WeakSet<Element>();
		let timer: ReturnType<typeof setTimeout> | undefined;
		const audit = () => {
			clearTimeout(timer);
			timer = setTimeout(() => {
				const fresh = unpointable().filter((element) => !warned.has(element));
				for (const element of fresh) warned.add(element);
				if (fresh.length > 0)
					console.warn("controls with no anchor to point at", fresh);
			}, AUDIT_SETTLE_MS);
		};
		audit();
		const unsubscribe = subscribe(audit);
		return () => {
			clearTimeout(timer);
			unsubscribe();
		};
	}, [enabled]);
}
