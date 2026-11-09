import type React from "react";
import { cloneElement, createElement, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
	isComponentElement,
	isValidSvgx,
	type Svgx,
	shouldRecurseIntoChildren,
} from ".";
import type { LayeredSvgx } from "./layers";
import { getPath } from "./path";

type GrabHandler = (e: React.PointerEvent) => void;

type HostedComponent = {
	key: string;
	element: Svgx;
	html: boolean;
	grab: GrabHandler | undefined;
};

const SVG_NS = "http://www.w3.org/2000/svg";

export class ComponentHost {
	private containers = new Map<string, { el: Element; html: boolean }>();
	private refCallbacks = new Map<string, (node: Element | null) => void>();
	private retained = new Map<string, HostedComponent>();

	frame(
		layered: LayeredSvgx,
		keepAbsent: boolean,
	): { layered: LayeredSvgx; portals: ReactNode } {
		const current = new Map<string, HostedComponent>();
		const byId = new Map(
			[...layered.byId].map(([id, layer]) => [
				id,
				{
					...layer,
					element: this.walk(layer.element, false, undefined, current),
				},
			]),
		);

		const hosted = keepAbsent
			? new Map([...this.retained, ...current])
			: current;
		this.retained = hosted;
		for (const key of [...this.containers.keys()]) {
			if (!hosted.has(key)) {
				this.containers.delete(key);
				this.refCallbacks.delete(key);
			}
		}

		const portals = [...hosted.values()].map((component) => (
			<g key={component.key} onPointerDown={component.grab}>
				{createPortal(
					stripDragologyProps(component.element),
					this.container(component),
				)}
			</g>
		));
		return { layered: { ...layered, byId }, portals };
	}

	private container(component: HostedComponent): Element {
		const existing = this.containers.get(component.key);
		if (existing && existing.html === component.html) return existing.el;
		let el: Element;
		if (component.html) {
			el = document.createElement("div");
			(el as HTMLElement).style.display = "contents";
		} else {
			el = document.createElementNS(SVG_NS, "g");
		}
		this.containers.set(component.key, { el, html: component.html });
		return el;
	}

	private refCallback(key: string): (node: Element | null) => void {
		let cb = this.refCallbacks.get(key);
		if (!cb) {
			cb = (node) => {
				const container = this.containers.get(key)?.el;
				if (node && container && container.parentNode !== node) {
					node.appendChild(container);
				}
			};
			this.refCallbacks.set(key, cb);
		}
		return cb;
	}

	private walk(
		node: Svgx,
		html: boolean,
		grab: GrabHandler | undefined,
		out: Map<string, HostedComponent>,
	): Svgx {
		if (isComponentElement(node)) {
			const key = getPath(node);
			if (key === undefined) return node;
			out.set(key, { key, element: node, html, grab });
			return html
				? createElement("div", {
						key: node.key,
						ref: this.refCallback(key),
						style: { display: "contents" },
					})
				: createElement("g", { key: node.key, ref: this.refCallback(key) });
		}

		const { children, onPointerDown, dragologyOnDrag } = node.props;
		if (children === undefined || !shouldRecurseIntoChildren(node)) {
			return node;
		}
		const childGrab =
			dragologyOnDrag && onPointerDown ? (onPointerDown as GrabHandler) : grab;
		const childHtml = node.type === "foreignObject";

		let changed = false;
		const walkChild = (child: ReactNode): ReactNode => {
			if (Array.isArray(child)) {
				const mapped = child.map(walkChild);
				if (mapped.some((c, i) => c !== child[i])) return mapped;
				return child;
			}
			if (!isValidSvgx(child)) return child;
			const result = this.walk(child, childHtml, childGrab, out);
			if (result !== child) changed = true;
			return result;
		};
		const newChildren = walkChild(children);
		return changed ? cloneElement(node, undefined, newChildren) : node;
	}
}

function stripDragologyProps(element: Svgx): Svgx {
	const props: Record<string, unknown> = {};
	for (const [k, v] of Object.entries(element.props)) {
		if (k === "data-path" || k.startsWith("dragology")) continue;
		props[k] = v;
	}
	return createElement(element.type, props);
}
