import { useLayoutEffect, useRef } from "react";

/** Size only this detail workspace; never disable scrolling on the document. */
export function useAccountDetailViewport(enabled = true) {
    const ref = useRef<HTMLElement>(null);
    useLayoutEffect(() => {
        const element = ref.current;
        if (!enabled || !element) return;
        const measure = () => {
            const top = element.getBoundingClientRect().top + window.scrollY;
            element.style.setProperty("--account-page-top", `${Math.ceil(top)}px`);
        };
        measure();
        window.addEventListener("resize", measure);
        const observer = new ResizeObserver(measure);
        const topbar = document.querySelector(".topbar");
        if (topbar) observer.observe(topbar);
        return () => { observer.disconnect(); window.removeEventListener("resize", measure); };
    }, [enabled]);
    return ref;
}
