"use client";

import { useEffect } from "react";
import { Card } from "@/components/ui";

// Generic centered popup — same visual/interaction pattern as
// HelpTooltip's modal (backdrop, X to close, scroll-locked while open), but
// opened programmatically (e.g. in response to a server action's result)
// rather than by a dedicated "?" trigger button.
export function Modal({ onClose, children }: { onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <Card className="max-w-xs w-full relative" onClick={(e) => e.stopPropagation()}>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute -top-2 -end-2 h-9 w-9 flex items-center justify-center rounded-full bg-[var(--surface)] border border-[var(--border)] text-[var(--foreground)] text-base leading-none"
        >
          ✕
        </button>
        {children}
      </Card>
    </div>
  );
}
