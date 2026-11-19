const PATHS: Record<string, string> = {
  plus: 'M12 5v14M5 12h14',
  minus: 'M5 12h14',
  close: 'M6 6l12 12M18 6 6 18',
  back: 'M15 5 8 12l7 7',
  check: 'm5 12.5 4.5 4.5L19 7.5',
  share: 'M8.2 10.8l7.6-3.6M8.2 13.2l7.6 3.6',
  layers: 'M12 3 3 8l9 5 9-5-9-5ZM3 13l9 5 9-5',
  locate: 'M12 2v3M12 19v3M2 12h3M19 12h3',
  moon: 'M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5Z',
  edit: 'M4 20h4L19 9l-4-4L4 16v4Z',
  trash: 'M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13',
  eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z',
  eyeoff: 'M3 3l18 18M10.6 6.1A9.6 9.6 0 0 1 12 5c6 0 10 7 10 7a17 17 0 0 1-3 3.6M6.5 7.2C3.9 9 2 12 2 12s4 7 10 7a9.5 9.5 0 0 0 4-.9',
  download: 'M12 4v11M7 11l5 5 5-5M5 20h14',
  chevron: 'm6 9 6 6 6-6',
  info: 'M12 11v5M12 8h.01',
}

interface IconProps {
  name: keyof typeof PATHS
  size?: number
}

/** Einfache Strich-Icons (inline SVG, dekorativ: der Button trägt das aria-label). */
export function Icon({ name, size = 22 }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {name === 'share' && (
        <>
          <circle cx="6" cy="12" r="2.5" />
          <circle cx="18" cy="6" r="2.5" />
          <circle cx="18" cy="18" r="2.5" />
        </>
      )}
      {name === 'locate' && (
        <>
          <circle cx="12" cy="12" r="7" />
          <circle cx="12" cy="12" r="2.5" fill="currentColor" />
        </>
      )}
      {name === 'info' && <circle cx="12" cy="12" r="9" />}
      {name === 'eye' && <circle cx="12" cy="12" r="3" />}
      <path d={PATHS[name]} />
    </svg>
  )
}

export function Logo({ size = 30 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <circle cx="16" cy="16" r="13" fill="none" stroke="var(--pri)" strokeWidth="2.5" strokeDasharray="4 3.2" />
      <path d="M16 22.5c-4.5-1.2-6.5-5-5.6-9.8 4.6-.4 8.6 1.6 9.2 6.2-.3 1.5-1.4 3-3.6 3.6Z" fill="var(--pri)" />
    </svg>
  )
}
