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
 * One shape per vehicle. Sharing looked reasonable until the book's own descriptions were
 * read: a Micro Flyer is fabric over spars that packs into a pickup, a CASRA is a
 * rotorwing, a Dropcraft is a VTOL transport built to loiter. Three of them had been given
 * the same fixed-wing outline, which was not a simplification but a wrong drawing.
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

function Microlight() {
  return (
    <>
      {/* A delta wing with a pod slung under it — featherlight, and packs into a pickup.
          Drawn thin on purpose: this is fabric over spars, not a fuselage. */}
      <path d="M50 8 L91 64 L74 69 L50 52 L26 69 L9 64 Z" {...BODY} />
      <path d="M50 8 L50 52" {...GHOST} />
      <path d="M26 69 L74 69" {...GHOST} />
      <rect x={45} y={46} width={10} height={22} rx={2} {...DETAIL} />
      <path d="M50 68 L50 90" {...DETAIL} />
      <path d="M42 90 L58 90" {...DETAIL} />
    </>
  );
}

function Multirotor() {
  return (
    <>
      {/* CASRA: a rotorwing, not a jet. Four discs and a gun on the nose. */}
      <circle cx={19} cy={21} r={15} {...GHOST} />
      <circle cx={81} cy={21} r={15} {...GHOST} />
      <circle cx={19} cy={79} r={15} {...GHOST} />
      <circle cx={81} cy={79} r={15} {...GHOST} />
      <path d="M42 34 L19 21" {...DETAIL} />
      <path d="M58 34 L81 21" {...DETAIL} />
      <path d="M42 64 L19 79" {...DETAIL} />
      <path d="M58 64 L81 79" {...DETAIL} />
      <path d="M50 18 L59 30 L59 64 L50 78 L41 64 L41 30 Z" {...BODY} />
      <path d="M50 18 L50 6" {...BODY} />
      <path d="M44 36 L56 36 L56 48 L44 48 Z" {...DETAIL} />
    </>
  );
}

function Vtol() {
  return (
    <>
      {/* Dropcraft: armoured box, tilt rotors, rear ramp. Built to loiter and unload. */}
      <circle cx={13} cy={46} r={13} {...GHOST} />
      <circle cx={87} cy={46} r={13} {...GHOST} />
      <path d="M40 6 L60 6 L68 19 L68 77 L60 93 L40 93 L32 77 L32 19 Z" {...BODY} />
      <path d="M32 36 L15 41 L15 52 L32 47 Z" {...BODY} />
      <path d="M68 36 L85 41 L85 52 L68 47 Z" {...BODY} />
      <path d="M39 16 L61 16 L64 25 L36 25 Z" {...DETAIL} />
      <circle cx={50} cy={33} r={5} {...DETAIL} />
      <path d="M36 79 L64 79" {...DETAIL} />
      <path d="M40 85 L60 85" {...GHOST} />
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

function Apc() {
  return (
    <>
      <path d="M38 5 L62 5 L70 18 L70 82 L62 95 L38 95 L30 82 L30 18 Z" {...BODY} />
      <path d="M30 30 L70 30" {...DETAIL} />
      <path d="M30 62 L70 62" {...DETAIL} />
      <path d="M43 40 L57 40 L59 48 L57 56 L43 56 L41 48 Z" {...BODY} />
      <path d="M49 40 L49 20 L51 20 L51 40" {...BODY} />
      <Wheels ys={[14, 42, 70]} inset={19} w={8} h={14} />
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
  bike: Bike, car: Car, van: Van, microlight: Microlight, heli: Heli,
  multirotor: Multirotor, vtol: Vtol, apc: Apc, tracked: Tracked, hover: Hover,
};

/** The wireframe for a layout, as SVG children — the caller owns the <svg> and its size. */
export function VehicleArt({ layout }: { layout: string }) {
  const Draw = ART[layout] ?? Car;
  return <Draw />;
}
