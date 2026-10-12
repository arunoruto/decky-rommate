// The rommate mark: a D-pad whose down arm is a download arrow.
export function RommateIcon({ size = "1em" }: { size?: string | number }) {
  return (
    <svg viewBox="0 0 128 128" width={size} height={size} aria-hidden="true">
      <defs>
        <mask id="rommate-cut" maskUnits="userSpaceOnUse" x="0" y="0" width="128" height="128">
          <rect x="45" y="10" width="38" height="108" rx="11" fill="#fff" />
          <rect x="10" y="45" width="108" height="38" rx="11" fill="#fff" />
          <path
            d="M64 28 V96 M47 79 L64 96 L81 79"
            fill="none"
            stroke="#000"
            strokeWidth="10"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </mask>
      </defs>
      <rect width="128" height="128" fill="currentColor" mask="url(#rommate-cut)" />
    </svg>
  );
}
