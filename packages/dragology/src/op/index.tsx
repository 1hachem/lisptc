import type { ReactNode } from "react";
import type {
	DragBehavior,
	DragFrame,
	DragInitContext,
	DragResult,
} from "../DragBehavior";
import type { DragSpecData } from "../DragSpec";
import { Box, SpecNode } from "../DragSpecTreeView";
import type { Vec2 } from "../math/vec2";
import { OverlayVis } from "../OverlayVis";

export type OpResult<T extends object> = Omit<
	DragResult<T>,
	"activePath" | "op"
> & { activePath?: string };

export type OpClass<T extends object, A extends unknown[]> = new (
	ctx: DragInitContext<T>,
	...args: A
) => Operator<T>;

export type OpTreeViewProps = {
	path: string;
	childPath: string;
	active: boolean;
	color: string | undefined;
};

export type OpOverlayVisProps = {
	active: boolean;
	opacity: number;
};

export abstract class Operator<T extends object> {
	abstract readonly name: string;
	readonly children: Child<T>[] = [];
	frames = 0;
	lastFrame: DragFrame | undefined;

	constructor(readonly ctx: DragInitContext<T>) {}

	protected child(
		key: string | null,
		spec: DragSpecData<T>,
		ctx: DragInitContext<T> = this.ctx,
	): Child<T> {
		const child = new Child(key, spec, ctx);
		const i = this.children.findIndex((c) => c.key === key);
		if (i === -1) this.children.push(child);
		else this.children[i] = child;
		return child;
	}

	abstract frame(frame: DragFrame): OpResult<T>;

	abstract treeView(props: OpTreeViewProps): ReactNode;

	abstract overlayVis(props: OpOverlayVisProps): ReactNode;

	fuzzDropPositions?(): Vec2[];
}

export abstract class Modifier<T extends object> extends Operator<T> {
	readonly inner: Child<T>;
	constructor(
		ctx: DragInitContext<T>,
		inner: DragSpecData<T>,
		innerCtx: DragInitContext<T> = ctx,
	) {
		super(ctx);
		this.inner = this.child(null, inner, innerCtx);
	}

	treeView(props: OpTreeViewProps): ReactNode {
		return this.wrapperView(props);
	}

	overlayVis({ active }: OpOverlayVisProps): ReactNode {
		return <OverlayVis op={this.inner.op} active={active} />;
	}

	protected wrapperView(props: OpTreeViewProps, detail?: string): ReactNode {
		return (
			<Box
				label={detail ? `${this.name} (${detail})` : this.name}
				path={props.path}
			>
				{this.inner.treeView(props)}
			</Box>
		);
	}
}

export class Child<T extends object> {
	readonly op: Operator<T>;
	private readonly behavior: DragBehavior<T>;

	constructor(
		readonly key: string | null,
		spec: DragSpecData<T>,
		ctx: DragInitContext<T>,
	) {
		this.op = new spec.opClass(ctx, ...spec.args);
		this.behavior = opBehavior(this.op);
	}

	run(frame: DragFrame): OpResult<T> & { activePath: string } {
		const { op: _op, activePath, ...result } = this.behavior(frame);
		return { ...result, activePath: joinPath(this.key, activePath) };
	}

	treeView({ childPath }: OpTreeViewProps): ReactNode {
		return (
			<SpecNode
				key={this.key}
				op={this.op}
				path={this.key === null ? childPath : `${childPath}${this.key}/`}
			/>
		);
	}
}

export function opBehavior<T extends object>(op: Operator<T>): DragBehavior<T> {
	return (frame) => {
		const { activePath, ...result } = op.frame(frame);
		op.frames++;
		op.lastFrame = frame;
		return { ...result, activePath: joinPath(op.name, activePath), op };
	};
}

export function joinPath(...segments: (string | null | undefined)[]): string {
	return segments.filter((s) => s !== null && s !== undefined).join("/");
}
