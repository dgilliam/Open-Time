"use client";

import { useEffect } from "react";

export function Dialog({
  title,
  onClose,
  children,
  variant = "modal",
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  /** "modal" (default) = current centered behavior. "drawer" (v2.9 section
   * B) = right-anchored full-height panel, bottom sheet on mobile. */
  variant?: "modal" | "drawer";
}) {
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const backdropClassName =
    variant === "drawer" ? "dialog-backdrop dialog-backdrop-drawer" : "dialog-backdrop";
  const dialogClassName = variant === "drawer" ? "dialog dialog-drawer" : "dialog";

  return (
    <div className={backdropClassName} onClick={onClose}>
      <div className={dialogClassName} onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <div className="dialog-header">
          <h3>{title}</h3>
          <button type="button" className="btn-icon" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
