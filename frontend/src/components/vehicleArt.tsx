import React from 'react';

/**
 * Top-down vehicle wireframes for the seating diagram.
 *
 * Drawn rather than illustrated: the city itself is wireframe with deliberately low
 * segment counts, and a photo-real car dropped into that would read as a foreign object.
 * Stroke-only and `currentColor` throughout, so each takes the theme it is rendered in.
 *
 * The viewBox is 0 0 100 100 and the seat anchors are percentages, which makes them the
 * same numbers — a seat marker lands where the seat is drawn without a conversion step in
 * between to get wrong.
 *
 * Seven shapes cover the book's ten vehicles. Sharing is fine where the silhouette is
 * honest — a Truck and an APC are both boxes on wheels from above — but a Helicopter and
 * a Dropcraft are not the same object and should not borrow one outline.
 */

const BODY = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinejoin: 'round' as const };
const DETAIL = { fill: 'none', stroke: 'currentColor', strokeWidth: 0.9, opacity: 0.55, strokeLinejoin: 'round' as const };
const GHOST = { fill: 'none', stroke: 'currentColor', strokeWidth: 0.7, opacity: 0.28 };

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

function Air() {
  return (
    <>
      <path d="M50 3 L55 18 L55 54 L53 90 L47 90 L45 54 L45 18 Z" {...BODY} />
      {/* Swept wings, so it reads as fixed-wing rather than as a very thin car. */}
      <path d="M45 32 L13 52 L13 59 L45 47 Z" {...BODY} />
      <path d="M55 32 L87 52 L87 59 L55 47 Z" {...BODY} />
      <path d="M45 76 L29 85 L29 90 L45 83 Z" {...DETAIL} />
      <path d="M55 76 L71 85 L71 90 L55 83 Z" {...DETAIL} />
      <path d="M47 13 L53 13 L53 27 L47 27 Z" {...DETAIL} />
    </>
  );
}

function Heli() {
  return (
    <>
      {/* The rotor disc first and faintest — it is the largest shape but not the subject. */}
      <circle cx={50} cy={38} r={44} {...GHOST} />
      <path d="M12 16 L88 60" {...GHOST} />
      <path d="M12 60 L88 16" {...GHOST} />
      <path d="M50 10 L61 20 L62 38 L57 54 L43 54 L38 38 L39 20 Z" {...BODY} />
      <path d="M48 54 L52 54 L52 84 L48 84 Z" {...BODY} />
      <path d="M42 84 L58 84" {...DETAIL} />
      <circle cx={50} cy={84} r={4} {...DETAIL} />
      <path d="M43 18 L57 18 L58 28 L42 28 Z" {...DETAIL} />
    </>
  );
}

function Tracked() {
  return (
    <>
      <path d="M31 12 L69 12 L69 88 L31 88 Z" {...BODY} />
      <rect x={17} y={9} width={11} height={82} rx={1} {...BODY} />
      <rect x={72} y={9} width={11} height={82} rx={1} {...BODY} />
      {/* Track links, spaced wide enough to read as tread rather than as hatching. */}
      {[16, 28, 40, 52, 64, 76].map((y) => (
        <React.Fragment key={y}>
          <path d={`M17 ${y} L28 ${y}`} {...GHOST} />
          <path d={`M72 ${y} L83 ${y}`} {...GHOST} />
        </React.Fragment>
      ))}
      <path d="M40 34 L60 34 L62 48 L58 58 L42 58 L38 48 Z" {...BODY} />
      <path d="M48 34 L48 6 L52 6 L52 34" {...BODY} />
    </>
  );
}

function Hover() {
  return (
    <>
      {/* The skirt is the widest thing on a ground-effect vehicle, so it is the outline. */}
      <path d="M36 6 L64 6 L82 26 L82 74 L64 94 L36 94 L18 74 L18 26 Z" {...BODY} />
      <path d="M40 20 L60 20 L69 34 L69 66 L60 80 L40 80 L31 66 L31 34 Z" {...DETAIL} />
      <circle cx={50} cy={30} r={7} {...DETAIL} />
      <circle cx={50} cy={68} r={7} {...DETAIL} />
      <path d="M18 50 L31 50" {...GHOST} />
      <path d="M69 50 L82 50" {...GHOST} />
    </>
  );
}

const ART: Record<string, () => React.JSX.Element> = {
  bike: Bike, car: Car, van: Van, air: Air, heli: Heli, tracked: Tracked, hover: Hover,
};

/** The wireframe for a layout, as SVG children — the caller owns the <svg> and its size. */
export function VehicleArt({ layout }: { layout: string }) {
  const Draw = ART[layout] ?? Car;
  return <Draw />;
}
