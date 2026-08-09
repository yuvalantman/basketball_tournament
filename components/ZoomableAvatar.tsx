"use client";

import { useEffect, useState } from "react";
import { Avatar } from "@/components/ui";

// Wraps Avatar with click-to-enlarge: tapping a photo opens it centered and
// full-size with an X to close. No-op (renders a plain Avatar) when there's
// no photo — nothing to zoom into for an initials fallback.
export function ZoomableAvatar({
  src,
  name,
  size = 44,
}: {
  src?: string | null;
  name: string;
  size?: number;
}) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  if (!src) return <Avatar src={src} name={name} size={size} />;

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="shrink-0">
        <Avatar src={src} name={name} size={size} />
      </button>
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-6"
          onClick={() => setOpen(false)}
        >
          <div className="relative max-w-sm w-full" onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close"
              className="absolute -top-3 -end-3 h-9 w-9 flex items-center justify-center rounded-full bg-[var(--surface)] border border-[var(--border)] text-[var(--foreground)] text-base leading-none z-10"
            >
              ✕
            </button>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={src} alt={name} className="w-full aspect-square object-cover rounded-2xl" />
          </div>
        </div>
      )}
    </>
  );
}
