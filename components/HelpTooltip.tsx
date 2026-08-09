"use client";

import { useEffect, useState } from "react";
import { Card } from "@/components/ui";

// Small "?" affordance for short contextual explanations. Not shown by
// default — click opens a centered modal, X (or backdrop click) closes it.
// Takes an already-resolved string rather than a translation key, so it
// needs no changes when i18n lands — only call sites swap the literal for
// t("...").
export function HelpTooltip({ text, className }: { text: string; className?: string }) {
  const [open, setOpen] = useState(false);

  // Lock background scroll while the modal is open — without this, a touch
  // that misses the (small) close button on mobile gets read as a scroll on
  // the page behind instead of a tap on the modal, so it feels stuck open.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Help"
        className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-[var(--border)] text-[11px] font-semibold text-[var(--muted)] hover:text-[var(--foreground)] hover:border-[var(--foreground)] transition ${className ?? ""}`}
      >
        ?
      </button>
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => setOpen(false)}
        >
          <Card
            className="max-w-xs w-full relative"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close"
              className="absolute -top-2 -end-2 h-9 w-9 flex items-center justify-center rounded-full bg-[var(--surface)] border border-[var(--border)] text-[var(--muted)] hover:text-[var(--foreground)] text-base leading-none"
            >
              ✕
            </button>
            <p className="text-sm pe-4">{text}</p>
          </Card>
        </div>
      )}
    </>
  );
}
