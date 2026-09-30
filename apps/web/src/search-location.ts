import { useRouterState } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";

const locateEvent = "keepany-search-locate";

function decodeHash(hash: string): string {
	try { return decodeURIComponent(hash.replace(/^#/, "")); }
	catch { return ""; }
}

/** Repeated clicks on the current hash still reveal a filtered-out result. */
export function requestSearchLocation(hash: string): void {
	window.dispatchEvent(new CustomEvent(locateEvent, { detail: hash }));
}

export function useSearchRowLocation(
	prefix: string,
	availableIds: readonly string[],
	visibleIds: readonly string[],
	reveal?: () => void,
	loadTarget?: (id: string) => (() => void) | undefined,
): void {
	const hash = useRouterState({ select: (state) => state.location.hash });
	const decoded = decodeHash(hash);
	const id = decoded.startsWith(prefix) ? decoded.slice(prefix.length) : "";
	const [activation, setActivation] = useState(0);
	const [request, setRequest] = useState<{ id: string; key: string } | null>(null);
	const handled = useRef("");
	const focused = useRef("");
	const revealRef = useRef(reveal);
	revealRef.current = reveal;
	const loadRef = useRef(loadTarget);
	loadRef.current = loadTarget;
	const availableKey = JSON.stringify(availableIds);
	const visibleKey = JSON.stringify(visibleIds);
	useEffect(() => {
		const locate = (event: Event) => {
			if (event instanceof CustomEvent && typeof event.detail === "string" && decodeHash(event.detail) === decoded)
				setActivation((value) => value + 1);
		};
		window.addEventListener(locateEvent, locate);
		return () => window.removeEventListener(locateEvent, locate);
	}, [decoded]);
	// biome-ignore lint/correctness/useExhaustiveDependencies: Repeated same-hash search clicks must re-read the target.
	useEffect(() => {
		if (id) return loadRef.current?.(id);
	}, [id, activation]);
	useEffect(() => {
		if (!id || !(JSON.parse(availableKey) as string[]).includes(id)) {
			handled.current = ""; focused.current = ""; setRequest(null); return;
		}
		const key = `${decoded}:${activation}`;
		if (handled.current === key) return;
		handled.current = key;
		revealRef.current?.();
		setRequest({ id, key });
	}, [id, decoded, activation, availableKey]);
	useEffect(() => {
		if (!request || focused.current === request.key || !(JSON.parse(visibleKey) as string[]).includes(request.id)) return;
		const frame = window.requestAnimationFrame(() => {
			const row = document.getElementById(`${prefix}${request.id}`);
			if (!row) return;
			focused.current = request.key;
			row.focus({ preventScroll: true });
			row.scrollIntoView({ block: "center" });
		});
		return () => window.cancelAnimationFrame(frame);
	}, [request, visibleKey, prefix]);
}
