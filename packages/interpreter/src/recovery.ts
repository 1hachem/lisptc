import { messageOf } from "./errors.ts";
import type { ForeignValue } from "./types.ts";

export interface ValueKind {
	readonly name: string;
	readonly claims?: (value: unknown) => boolean;
	readonly save?: (value: unknown) => unknown;
	readonly restore: (data: unknown) => unknown;
}

export interface Recipe {
	readonly kind: string;
	readonly args: readonly unknown[];
}

export type Resume = (
	args: readonly unknown[],
	signal: AbortSignal,
) => Promise<unknown>;

export interface Phase {
	readonly name: string;
	readonly run: () => void;
}

export interface RecoveryFailure {
	readonly name: string;
	readonly reason: string;
}

export class RecoveryError extends Error {}

export class Recovery {
	private readonly kinds = new Map<string, ValueKind>();
	private readonly resumes = new Map<string, Resume>();
	private readonly saving: Phase[] = [];
	private readonly restoring: Phase[] = [];

	kind(kind: ValueKind): void {
		this.claim(this.kinds, kind.name, kind);
	}

	resumable(name: string, resume: Resume): void {
		this.claim(this.resumes, name, resume);
	}

	beforeSave(name: string, run: () => void): void {
		this.phase(this.saving, { name, run });
	}

	afterRestore(name: string, run: () => void): void {
		this.phase(this.restoring, { name, run });
	}

	encode(value: unknown): ForeignValue | undefined {
		for (const kind of this.kinds.values())
			if (kind.claims?.(value) && kind.save)
				return { tag: kind.name, data: kind.save(value) };
		return undefined;
	}

	decodes(tag: string): boolean {
		return this.kinds.has(tag);
	}

	decode({ tag, data }: ForeignValue): unknown {
		const kind = this.kinds.get(tag);
		if (kind === undefined) throw new RecoveryError(`no kind restores ${tag}`);
		return kind.restore(data);
	}

	resumer(kind: string): Resume | undefined {
		return this.resumes.get(kind);
	}

	runBeforeSave(): void {
		for (const phase of [...this.saving].reverse())
			try {
				phase.run();
			} catch (error) {
				throw new RecoveryError(
					`${phase.name} refused the save: ${messageOf(error)}`,
				);
			}
	}

	runAfterRestore(): RecoveryFailure[] {
		const failed: RecoveryFailure[] = [];
		for (const phase of this.restoring)
			try {
				phase.run();
			} catch (error) {
				failed.push({ name: phase.name, reason: messageOf(error) });
			}
		return failed;
	}

	private claim<T>(into: Map<string, T>, name: string, value: T): void {
		if (into.has(name))
			throw new RecoveryError(`${name} is already registered`);
		into.set(name, value);
	}

	private phase(into: Phase[], phase: Phase): void {
		if (into.some((p) => p.name === phase.name))
			throw new RecoveryError(`${phase.name} is already registered`);
		into.push(phase);
	}
}
