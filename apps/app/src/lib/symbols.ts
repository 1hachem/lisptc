import type { Id } from "@repo/backend/dataModel";
import {
	type SymbolEntry,
	type SymbolTable,
	symbolTable,
} from "@repo/language-service";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef } from "react";
import { apiHeaders } from "./api.ts";

const NONE: SymbolTable = new Map();

async function fetchSymbols(chatId: Id<"chats">): Promise<SymbolEntry[]> {
	const res = await fetch("/api/symbols", {
		method: "POST",
		headers: await apiHeaders(),
		body: JSON.stringify({ chatId }),
	});
	if (!res.ok) throw new Error(`symbols: ${res.status}`);
	return res.json();
}

export function useSymbols(
	chatId: Id<"chats"> | null,
	isLoading: boolean,
): SymbolTable {
	const queryClient = useQueryClient();
	const queryKey = useMemo(() => ["lisp-symbols", chatId] as const, [chatId]);
	const { data } = useQuery({
		queryKey,
		queryFn: () => (chatId === null ? [] : fetchSymbols(chatId)),
		enabled: chatId !== null,
		staleTime: Number.POSITIVE_INFINITY,
	});
	const wasLoading = useRef(isLoading);
	useEffect(() => {
		if (wasLoading.current && !isLoading)
			void queryClient.invalidateQueries({ queryKey });
		wasLoading.current = isLoading;
	}, [isLoading, queryClient, queryKey]);
	return useMemo(() => (data === undefined ? NONE : symbolTable(data)), [data]);
}
