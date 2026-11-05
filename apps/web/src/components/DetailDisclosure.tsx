import { useState, type ReactNode } from "react";

/** Collapsed content is mounted on opening so canvas graphs measure their visible container. */
export function DetailDisclosure({ collapsible, label, className, id, children, tabIndex }: { collapsible: boolean; label: string; className: string; id?: string; children: ReactNode; tabIndex?: number }) {
  const [open, setOpen] = useState(false);
  if (!collapsible) return <section className={className} id={id} tabIndex={tabIndex}>{children}</section>;
  return <details className={`${className} detail-disclosure`} id={id} open={open} onToggle={event => setOpen(event.currentTarget.open)}>
    <summary>{label}</summary>{open ? children : null}
  </details>;
}
