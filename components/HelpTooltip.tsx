"use client";

import { useState } from "react";
import { Card } from "@/components/ui";

// Small "?" affordance for short contextual explanations. Not shown by
// default — click opens a centered modal, X (or backdrop click) closes it.
// Takes an already-resolved string rather than a translation key, so it
// needs no changes when i18n lands — only call sites swap the literal for
// t("...").
export function HelpTooltip({ text, className }: { text: string; className?: string }) {
  const [open, setOpen] = useState(false);

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
              className="absolute top-3 end-3 text-[var(--muted)] hover:text-[var(--foreground)] text-lg leading-none"
            >
              ✕
            </button>
            <p className="text-sm pe-6">{text}</p>
          </Card>
        </div>
      )}
    </>
  );
}
