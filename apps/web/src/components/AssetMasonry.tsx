import { useLayoutEffect, useRef, type ReactNode } from 'react';

/** Keep DOM and keyboard order in the selected sort order, packing each next card into the shortest column. */
export function AssetMasonry({ children, label }: { children: ReactNode; label: string }) {
 const container = useRef<HTMLElement>(null);
 const widthProbe = useRef<HTMLSpanElement>(null);
 useLayoutEffect(() => {
  const element = container.current;
  if (!element) return;
  let disposed = false;
  const setStyle = (element: HTMLElement, key: 'width'|'height'|'top'|'left', value: string) => { if(element.style[key] !== value)element.style[key] = value; };
  const layout = () => {
   if (disposed) return;
   const width = element.clientWidth;
   if (!width) return;
   // Measure in the final positioning mode; grid stretch can otherwise give stale first-frame heights.
   element.dataset.laidOut = 'true';
   const columns = Number(getComputedStyle(element).getPropertyValue('--masonry-columns')) || 1;
   const gap = 16;
   const cardWidth = (width - gap * (columns - 1)) / columns;
   const heights = Array<number>(columns).fill(0);
   const cards = Array.from(element.children) as HTMLElement[];
   for (const card of cards) setStyle(card,'width',`${cardWidth}px`);
   const sizes = cards.map(card => card.offsetHeight);
   for (const [index, card] of cards.entries()) {
    const column = heights.indexOf(Math.min(...heights));
    setStyle(card,'left',`${column * (cardWidth + gap)}px`);
    setStyle(card,'top',`${heights[column]}px`);
    heights[column] += sizes[index] + gap;
   }
   setStyle(element,'height',`${Math.max(0, ...heights) - (cards.length ? gap : 0)}px`);
  };
  // A fixed-height width probe avoids observing the container height that layout itself writes.
  // Run before paint instead of deferring a resize into another animation frame.
  const observer = new ResizeObserver(layout);
  if(widthProbe.current)observer.observe(widthProbe.current);
  for (const card of Array.from(element.children)) observer.observe(card);
  window.addEventListener('resize',layout);
  layout();
  return () => { disposed = true; observer.disconnect(); window.removeEventListener('resize',layout); };
 }, [children]);
 return <div className="asset-masonry-container"><span ref={widthProbe} className="asset-masonry-width" aria-hidden="true"/><section ref={container} className="asset-list-content workspace-asset-grid" aria-label={label}>{children}</section></div>;
}
