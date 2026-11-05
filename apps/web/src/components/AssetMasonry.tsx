import { useLayoutEffect, useRef, type ReactNode } from 'react';

/** Keep DOM and keyboard order in the selected sort order, packing each next card into the shortest column. */
export function AssetMasonry({ children, label }: { children: ReactNode; label: string }) {
 const container = useRef<HTMLElement>(null);
 useLayoutEffect(() => {
  const element = container.current;
  if (!element) return;
  let frame = 0;
  let disposed = false;
  const layout = () => {
   if (disposed) return;
   const width = element.clientWidth;
   if (!width) return;
   const columns = Number(getComputedStyle(element).getPropertyValue('--masonry-columns')) || 1;
   const gap = 16;
   const cardWidth = (width - gap * (columns - 1)) / columns;
   const heights = Array<number>(columns).fill(0);
   const cards = Array.from(element.children) as HTMLElement[];
   for (const card of cards) card.style.width = `${cardWidth}px`;
   const sizes = cards.map(card => card.offsetHeight);
   for (const [index, card] of cards.entries()) {
    const column = heights.indexOf(Math.min(...heights));
    card.style.left = `${column * (cardWidth + gap)}px`;
    card.style.top = `${heights[column]}px`;
    heights[column] += sizes[index] + gap;
   }
   element.style.height = `${Math.max(0, ...heights) - (cards.length ? gap : 0)}px`;
   element.dataset.laidOut = 'true';
  };
  const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(layout); };
  const observer = new ResizeObserver(schedule);
  observer.observe(element);
  for (const card of Array.from(element.children)) observer.observe(card);
  layout();
  return () => { disposed = true; cancelAnimationFrame(frame); observer.disconnect(); };
 }, [children]);
 return <section ref={container} className="asset-list-content workspace-asset-grid" aria-label={label}>{children}</section>;
}
