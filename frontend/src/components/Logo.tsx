/**
 * The Localake mark: layered bands reading as both strata and a lake surface.
 * Purely geometric so it stays legible at sidebar size and as a favicon.
 */
export function Logo({ size = 30 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      role="img"
      aria-label="Localake"
    >
      <defs>
        <linearGradient id="localake-mark" x1="0" y1="0" x2="32" y2="32">
          <stop offset="0%" stopColor="#4a6df0" />
          <stop offset="100%" stopColor="#2843c9" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="8.5" fill="url(#localake-mark)" />
      <rect x="7" y="8.5" width="18" height="3.4" rx="1.7" fill="#fff" opacity="0.95" />
      <rect x="7" y="14.3" width="12.5" height="3.4" rx="1.7" fill="#fff" opacity="0.7" />
      <rect x="7" y="20.1" width="15.5" height="3.4" rx="1.7" fill="#fff" opacity="0.45" />
    </svg>
  );
}
