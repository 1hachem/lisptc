import "react";
import type { DragSpecBrand } from "./DragSpec";

declare module "react" {
	namespace JSX {
		interface IntrinsicAttributes {
			dragologyLerpProps?: readonly string[] | boolean;
		}
	}

	interface SVGAttributes<T> {
		dragologyOnDrag?: (() => DragSpecBrand) | false | null | undefined;

		dragologyZIndex?: number | string | false | null;
		dragologyTransition?: boolean;
		dragologyEmergeFrom?: string;
		dragologyEmergeMode?: "clone" | "scale";
		dragologyOpaque?: boolean;
		dragologyKey?: string;
	}
}
