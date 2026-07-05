"use client";

// Small icon button shared by the three nav-chrome triggers introduced in
// v2.3 (desktop collapse chevron, floating expand button, mobile hamburger).
// Kept tiny and generic so all three get the same aria-label/aria-expanded
// contract instead of drifting.

export function NavToggle({
  onClick,
  ariaLabel,
  ariaExpanded,
  className,
  children,
}: {
  onClick: () => void;
  ariaLabel: string;
  ariaExpanded: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      className={className ? `nav-toggle ${className}` : "nav-toggle"}
      onClick={onClick}
      aria-label={ariaLabel}
      aria-expanded={ariaExpanded}
    >
      {children}
    </button>
  );
}
