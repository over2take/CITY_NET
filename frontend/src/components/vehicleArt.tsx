import React from 'react';

/**
 * Top-down vehicle wireframes for the seating diagram.
 *
 * Drawn rather than illustrated: the city itself is wireframe with deliberately low
 * segment counts, and a photo-real car dropped into that would read as a foreign object.
 * Stroke-only and `currentColor` throughout, so each takes the theme it is rendered in.
 *
 * The viewBox is 0 0 100 100 and the seat anchors in sheets/vehicleLayouts.ts are
 * percentages, which makes them the same numbers — a seat marker lands where the seat is
 * drawn without a conversion step in between to get wrong.
 */

const BODY = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinejoin: 'round' as const };
const DETAIL = { fill: 'none', stroke: 'currentColor', strokeWidth: 0.9, opacity: 0.55, strokeLinejoin: 'round' as const };

/** Wheels sit outside the body on both sides, mirrored about the centre line. */
const Wheels = ({ ys, inset = 20, w = 7, h = 13 }: { ys: number[]; inset?: number; w?: number; h?: number }) => (
  <>
    {ys.map((y) => (
      <React.Fragment key={y}>
        <rect x={inset} y={y} width={w} height={h} rx={1} {...DETAIL} />
        <rect x={100 - inset - w} y={y} width={w} height={h} rx={1} {...DETAIL} />
      </React.Fragment>
    ))}
  </>
);

function Car() {
  return (
    <>
      {/* Nose at the top, tail at the bottom — the reading everyone brings to a floor plan. */}
      <path d="M50 5 L64 11 L71 25 L73 50 L72 79 L65 93 L35 93 L28 79 L27 50 L29 25 L36 11 Z" {...BODY} />
      <path d="M35 20 L65 20 L69 30 L31 30 Z" {...DETAIL} />
      <path d="M32 74 L68 74 L66 85 L34 85 Z" {...DETAIL} />
      <path d="M27 44 L73 44" {...DETAIL} />
      <Wheels ys={[20, 62]} />
    </>
  );
}

function Bike() {
  return (
    <>
      <path d="M50 6 L56 18 L57 44 L54 66 L50 94 L46 66 L43 44 L44 18 Z" {...BODY} />
      {/* Handlebars: the one detail that makes the front end unmistakable at this size. */}
      <path d="M34 20 L66 20" {...DETAIL} />
      <path d="M43 30 L57 30" {...DETAIL} />
      <rect x={47} y={8} width={6} height={16} rx={1} {...DETAIL} />
      <rect x={47} y={74} width={6} height={18} rx={1} {...DETAIL} />
    </>
  );
}

function Van() {
  return (
    <>
      <path d="M50 4 L66 9 L72 20 L73 50 L73 84 L67 95 L33 95 L27 84 L27 50 L28 20 L34 9 Z" {...BODY} />
      <path d="M33 15 L67 15 L70 23 L30 23 Z" {...DETAIL} />
      <path d="M27 35 L73 35" {...DETAIL} />
      <path d="M27 53 L73 53" {...DETAIL} />
      <path d="M27 71 L73 71" {...DETAIL} />
      <Wheels ys={[16, 72]} h={14} />
    </>
  );
}

const ART: Record<string, () => React.JSX.Element> = { car: Car, bike: Bike, van: Van };

/** The wireframe for a layout, as SVG children — the caller owns the <svg> and its size. */
export function VehicleArt({ layout }: { layout: string }) {
  const Draw = ART[layout] ?? Car;
  return <Draw />;
}
