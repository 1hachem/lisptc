"use server";

import { revalidatePath } from "next/cache";
import type { Analysis } from "@/lib/analyse.ts";
import { analyse } from "@/lib/analyse.ts";
import { removeVersion } from "@/lib/versions.ts";

export async function refresh(): Promise<Analysis> {
	const done = await analyse();
	revalidatePath("/", "layout");
	return done;
}

export async function forget(file: string): Promise<void> {
	await removeVersion(file);
	revalidatePath("/versions");
}
