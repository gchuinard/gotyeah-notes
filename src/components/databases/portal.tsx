"use client";
import { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";

// Renders children in a fixed portal anchored below `anchor`.
// Fires onClose when the user clicks outside both anchor and content.

type Props = {
  anchor: React.RefObject<HTMLElement | null>;
  onClose: () => void;
  children: React.ReactNode;
  minWidth?: number;
  className?: string;
};

export default function Portal({
  anchor,
  onClose,
  children,
  minWidth = 160,
  className = "bg-[var(--bg)] border border-[var(--border)] rounded-lg shadow-lg py-1 overflow-y-auto max-h-72",
}: Props) {
  const contentRef = useRef<HTMLDivElement>(null);
  const [style, setStyle] = useState<React.CSSProperties>({ visibility: "hidden" });
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    const el = anchor.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const width = Math.max(rect.width, minWidth);
    const left = Math.min(rect.left, window.innerWidth - width - 8);
    setStyle({
      position: "fixed",
      top: rect.bottom + 2,
      left: Math.max(8, left),
      minWidth: width,
      zIndex: 1000,
      visibility: "visible",
    });
  }, [anchor, minWidth]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (
        anchor.current?.contains(e.target as Node) ||
        contentRef.current?.contains(e.target as Node)
      ) return;
      onClose();
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [anchor, onClose]);

  if (!mounted) return null;
  return createPortal(
    <div ref={contentRef} style={style} className={className}>
      {children}
    </div>,
    document.body
  );
}
