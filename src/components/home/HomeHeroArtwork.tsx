/**
 * A product-owned, data-oriented illustration for the welcome workspace.
 * It is intentionally abstract: no database names, records, or platform UI.
 */
export function HomeHeroArtwork() {
  return (
    <svg
      viewBox="0 0 520 220"
      className="pointer-events-none absolute -right-5 -top-8 hidden h-[210px] w-[500px] max-w-[46%] min-[1000px]:block"
      aria-hidden="true"
    >
      <ellipse cx="259" cy="111" rx="202" ry="77" fill="hsl(var(--primary) / 0.025)" />

      <g transform="translate(122 42)">
        <ellipse cx="66" cy="25" rx="57" ry="19" fill="hsl(var(--surface))" stroke="hsl(var(--primary) / 0.25)" strokeWidth="2" />
        <path d="M9 25v69c0 10 25 19 57 19s57-9 57-19V25" fill="hsl(var(--primary) / 0.065)" stroke="hsl(var(--primary) / 0.25)" strokeWidth="2" />
        <path d="M9 59c0 10 25 19 57 19s57-9 57-19M9 82c0 10 25 19 57 19s57-9 57-19" fill="none" stroke="hsl(var(--primary) / 0.2)" strokeWidth="2" />
        <ellipse cx="66" cy="25" rx="57" ry="19" fill="hsl(var(--primary) / 0.065)" stroke="hsl(var(--primary) / 0.32)" strokeWidth="2" />
      </g>

      <g transform="rotate(-5 352 93)">
        <rect x="293" y="33" width="142" height="132" rx="13" fill="hsl(var(--surface) / 0.78)" stroke="hsl(var(--primary) / 0.17)" strokeWidth="2" />
        <rect x="315" y="58" width="49" height="8" rx="4" fill="hsl(var(--primary) / 0.36)" />
        <rect x="315" y="81" width="84" height="7" rx="3.5" fill="hsl(var(--primary) / 0.18)" />
        <rect x="315" y="103" width="67" height="7" rx="3.5" fill="hsl(var(--primary) / 0.18)" />
        <rect x="315" y="125" width="92" height="7" rx="3.5" fill="hsl(var(--primary) / 0.13)" />
      </g>

      <path d="M235 104c25-11 35-17 60-18M251 134c22 11 37 12 57 6" fill="none" stroke="hsl(var(--primary) / 0.2)" strokeDasharray="4 5" strokeLinecap="round" strokeWidth="2" />
      <circle cx="238" cy="103" r="4" fill="hsl(var(--primary) / 0.45)" />
      <circle cx="306" cy="86" r="4" fill="hsl(var(--primary) / 0.35)" />
      <circle cx="308" cy="140" r="4" fill="hsl(var(--primary) / 0.3)" />
    </svg>
  )
}
