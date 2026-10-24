import { useCallback, useEffect, useRef, useState } from "react";

const NOTICE_MS = 2000;

export type Flash = (message: string) => void;

export function useNotice(): [string | null, Flash] {
	const [notice, setNotice] = useState<string | null>(null);
	const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
	useEffect(() => () => clearTimeout(timer.current ?? undefined), []);
	const flash = useCallback((message: string) => {
		setNotice(message);
		clearTimeout(timer.current ?? undefined);
		timer.current = setTimeout(() => setNotice(null), NOTICE_MS);
	}, []);
	return [notice, flash];
}
