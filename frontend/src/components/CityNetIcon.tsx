// The CITY_NET badge - the hex, the skyline and the rhombus gem from assets/citynet-logo.svg
// - drawn in the current theme's colors rather than the logo's fixed green.
//
// Used where something needs a picture and has none: a building with no photo on a machine
// that cannot draw it in 3D. Strokes are currentColor and fills the theme's black, so it
// follows all seven themes without a color of its own.

export function CityNetIcon({ size = 120, title = 'CITY_NET' }: { size?: number; title?: string }) {
  const fill = 'var(--black)';
  return (
    <svg
      width={size}
      height={size}
      viewBox="110 40 460 400"
      role="img"
      aria-label={title}
      style={{ color: 'var(--green)', display: 'block' }}
    >
      <polygon points="340,48 560,175 560,400 340,527 120,400 120,175" fill={fill} stroke="currentColor" strokeWidth="6" />
      <polygon points="340,66 544,184 544,391 340,509 136,391 136,184" fill="none" stroke="currentColor" strokeWidth="2" opacity="0.35" />
      <g stroke="currentColor" fill={fill} opacity="0.5" strokeWidth="2">
        <rect x="172" y="300" width="34" height="120" />
        <rect x="238" y="268" width="30" height="152" />
        <rect x="414" y="282" width="30" height="138" />
        <rect x="474" y="312" width="34" height="108" />
      </g>
      <g stroke="currentColor" fill={fill} strokeWidth="3">
        <rect x="196" y="330" width="52" height="90" />
        <rect x="262" y="296" width="46" height="124" />
        <rect x="372" y="304" width="46" height="116" />
        <rect x="432" y="336" width="52" height="84" />
      </g>
      <line x1="150" y1="420" x2="530" y2="420" stroke="currentColor" strokeWidth="4" />
      <polygon points="340,118 412,208 340,298 268,208" fill={fill} stroke="currentColor" strokeWidth="5" />
      <g stroke="currentColor" strokeWidth="2" opacity="0.7">
        <line x1="268" y1="208" x2="412" y2="208" />
        <line x1="340" y1="118" x2="340" y2="298" />
      </g>
    </svg>
  );
}
