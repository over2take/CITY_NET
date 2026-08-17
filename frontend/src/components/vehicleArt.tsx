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

/* ── Shapes with no CWN vehicle behind them ──────────────────────────────────
 *
 * Drawn for Cyberpunk RED, which has water and civil aircraft the CWN table has none of.
 * Keyed by what the shape *is* rather than by any book's name for it, so they belong to the
 * app rather than to a ruleset — and so a third system can reuse a speedboat without
 * inheriting somebody else's vocabulary.
 */

function Sportbike() {
  return (
    <>
      {/* The roadbike with a fairing: narrower clip-ons, fat rear tyre, tucked tail.
          Deliberately the same silhouette family — it should read as the faster one. */}
      <path d="M50 4 L59 15 L60 38 L55 58 L52 90 L48 90 L45 58 L40 38 L41 15 Z" {...BODY} />
      <path d="M45 11 L55 11" {...GHOST} />
      <path d="M39 22 L61 22" {...DETAIL} />
      <path d="M39 22 L34 17" {...GHOST} />
      <path d="M61 22 L66 17" {...GHOST} />
      <path d="M44 32 L56 32" {...GHOST} />
      <rect x={47} y={6} width={6} height={15} rx={1} {...DETAIL} />
      <rect x={46} y={70} width={8} height={20} rx={1} {...DETAIL} />
    </>
  );
}

function Coupe() {
  return (
    <>
      {/* Wedge nose, cabin pushed back, wider track than the saloon. */}
      <path d="M50 4 L67 13 L74 33 L75 56 L72 82 L64 94 L36 94 L28 82 L25 56 L26 33 L33 13 Z" {...BODY} />
      <path d="M38 31 L62 31 L67 43 L33 43 Z" {...DETAIL} />
      <path d="M35 66 L65 66 L63 79 L37 79 Z" {...DETAIL} />
      <path d="M50 8 L50 26" {...GHOST} />
      <path d="M31 22 L69 22" {...GHOST} />
      <path d="M25 56 L75 56" {...GHOST} />
      <Wheels ys={[21, 65]} inset={18} w={8} h={15} />
    </>
  );
}

function Supercar() {
  return (
    <>
      {/* Mid-engine proportions: cockpit forward, wide rear haunches, deck louvres and a
          wing across the tail. The rear wheels are larger, so they are placed by hand
          rather than mirrored through Wheels. */}
      <path d="M50 6 L63 12 L71 32 L78 60 L75 86 L66 95 L34 95 L25 86 L22 60 L29 32 L37 12 Z" {...BODY} />
      <path d="M40 33 L60 33 L64 47 L36 47 Z" {...DETAIL} />
      <path d="M34 58 L66 58" {...GHOST} />
      <path d="M33 64 L67 64" {...GHOST} />
      <path d="M32 70 L68 70" {...GHOST} />
      <path d="M50 9 L50 28" {...GHOST} />
      <path d="M24 91 L76 91" {...BODY} />
      <rect x={17} y={20} width={7} height={14} rx={1} {...DETAIL} />
      <rect x={76} y={20} width={7} height={14} rx={1} {...DETAIL} />
      <rect x={14} y={61} width={9} height={18} rx={1} {...DETAIL} />
      <rect x={77} y={61} width={9} height={18} rx={1} {...DETAIL} />
    </>
  );
}

function Jetski() {
  return (
    <>
      {/* Pointed nose, straddle pad rather than a seat, jet nozzle at the stern. */}
      <path d="M50 8 L58 26 L59 56 L54 82 L46 82 L41 56 L42 26 Z" {...BODY} />
      <path d="M40 30 L60 30" {...DETAIL} />
      <path d="M40 30 L36 26" {...GHOST} />
      <path d="M60 30 L64 26" {...GHOST} />
      <rect x={45} y={42} width={10} height={26} rx={3} {...DETAIL} />
      <path d="M46 82 L46 90 L54 90 L54 82" {...DETAIL} />
      <path d="M44 16 L38 8" {...GHOST} />
      <path d="M56 16 L62 8" {...GHOST} />
    </>
  );
}

function Speedboat() {
  return (
    <>
      {/* Open runabout: wrap windscreen, two benches, outboard hung off the transom. */}
      <path d="M50 4 L60 22 L63 50 L61 80 L58 92 L42 92 L39 80 L37 50 L40 22 Z" {...BODY} />
      <path d="M42 34 L44 29 L56 29 L58 34" {...DETAIL} />
      <path d="M41 47 L59 47" {...DETAIL} />
      <path d="M41 63 L59 63" {...DETAIL} />
      <path d="M41 88 L59 88" {...DETAIL} />
      <rect x={46} y={92} width={8} height={6} rx={1} {...DETAIL} />
      <path d="M40 22 L60 22" {...GHOST} />
    </>
  );
}

function Cruiser() {
  return (
    <>
      {/* Cabin forward with an angled windscreen, open cockpit aft, flat transom.
          Deliberately squat, so it does not read as a small yacht. */}
      <path d="M50 5 L59 20 L62 45 L62 74 L59 90 L41 90 L38 74 L38 45 L41 20 Z" {...BODY} />
      <path d="M44 24 L56 24" {...GHOST} />
      <path d="M42 30 L58 30 L59 54 L41 54 Z" {...DETAIL} />
      <path d="M43 30 L57 30 L56 37 L44 37" {...GHOST} />
      <path d="M41 58 L59 58" {...DETAIL} />
      <path d="M41 86 L59 86" {...DETAIL} />
      <path d="M38 45 L62 45" {...GHOST} />
    </>
  );
}

function Yacht() {
  return (
    <>
      {/* Longer and flared at the bow, flybridge drawn inside the superstructure, swim
          platform off the stern. The side-deck nicks are what stop it reading as a
          scaled-up cruiser. */}
      <path d="M50 3 L61 17 L66 42 L66 74 L63 91 L37 91 L34 74 L34 42 L39 17 Z" {...BODY} />
      <path d="M50 7 L43 20" {...GHOST} />
      <path d="M50 7 L57 20" {...GHOST} />
      <path d="M40 28 L60 28 L62 60 L38 60 Z" {...DETAIL} />
      <path d="M44 33 L56 33 L57 47 L43 47 Z" {...DETAIL} />
      <path d="M38 64 L62 64" {...DETAIL} />
      <path d="M37 87 L63 87" {...DETAIL} />
      <path d="M42 91 L42 96 L58 96 L58 91" {...GHOST} />
      <path d="M34 42 L38 42 M62 42 L66 42" {...GHOST} />
      <path d="M34 74 L38 74 M62 74 L66 74" {...GHOST} />
    </>
  );
}

function Gyro() {
  return (
    <>
      {/* An unpowered rotor overhead, open pod, pusher prop and twin fins. The rotor is
          the largest shape and the faintest, the same way the helicopter's is. */}
      <circle cx={50} cy={42} r={42} {...GHOST} />
      <path d="M12 26 L88 58" {...GHOST} />
      <path d="M12 58 L88 26" {...GHOST} />
      <path d="M50 20 L57 28 L57 50 L50 58 L43 50 L43 28 Z" {...BODY} />
      <path d="M50 20 L50 10" {...BODY} />
      <path d="M50 58 L50 84" {...BODY} />
      <circle cx={50} cy={76} r={2} {...DETAIL} />
      <path d="M38 76 L62 76" {...DETAIL} />
      <path d="M42 86 L42 97" {...DETAIL} />
      <path d="M58 86 L58 97" {...DETAIL} />
      <path d="M42 90 L58 90" {...DETAIL} />
    </>
  );
}

function Aerodyne() {
  return (
    <>
      {/* Four ducted fans on stub pylons around an armoured hull. The ducts are structure,
          not air, so they are drawn as detail — unlike the tilt-rotor's free discs. */}
      <circle cx={20} cy={28} r={13} {...DETAIL} />
      <circle cx={80} cy={28} r={13} {...DETAIL} />
      <circle cx={20} cy={72} r={13} {...DETAIL} />
      <circle cx={80} cy={72} r={13} {...DETAIL} />
      <circle cx={20} cy={28} r={4} {...GHOST} />
      <circle cx={80} cy={28} r={4} {...GHOST} />
      <circle cx={20} cy={72} r={4} {...GHOST} />
      <circle cx={80} cy={72} r={4} {...GHOST} />
      <path d="M39 26 L20 28" {...BODY} />
      <path d="M61 26 L80 28" {...BODY} />
      <path d="M39 74 L20 72" {...BODY} />
      <path d="M61 74 L80 72" {...BODY} />
      <path d="M50 5 L60 15 L62 44 L62 76 L56 93 L44 93 L38 76 L38 44 L40 15 Z" {...BODY} />
      <path d="M43 13 L57 13 L59 24 L41 24 Z" {...DETAIL} />
      <path d="M38 52 L62 52" {...GHOST} />
      <path d="M40 86 L60 86" {...DETAIL} />
    </>
  );
}

function AerodyneDelta() {
  return (
    <>
      {/* The fast one: swept delta, two large thrust ducts, none of the boxiness. */}
      <path d="M50 3 L58 19 L62 50 L60 76 L66 93 L34 93 L40 76 L38 50 L42 19 Z" {...BODY} />
      <path d="M38 42 L12 60 L16 70 L39 58 Z" {...BODY} />
      <path d="M62 42 L88 60 L84 70 L61 58 Z" {...BODY} />
      <circle cx={22} cy={63} r={8} {...DETAIL} />
      <circle cx={78} cy={63} r={8} {...DETAIL} />
      <path d="M45 15 L55 15 L57 30 L43 30 Z" {...DETAIL} />
      <path d="M50 5 L50 15" {...GHOST} />
      <path d="M42 93 L42 99" {...GHOST} />
      <path d="M58 93 L58 99" {...GHOST} />
    </>
  );
}

function Airship() {
  return (
    <>
      {/* The only one where the outline is not the vehicle: the envelope is, with the
          gondola slung underneath and fins at the tail. */}
      <ellipse cx={50} cy={44} rx={26} ry={41} {...BODY} />
      <ellipse cx={50} cy={44} rx={11} ry={39} {...GHOST} />
      <path d="M24 44 L76 44" {...GHOST} />
      <circle cx={50} cy={5} r={3} {...DETAIL} />
      <rect x={42} y={50} width={16} height={24} rx={2} {...DETAIL} />
      <path d="M46 56 L54 56" {...GHOST} />
      <path d="M46 64 L54 64" {...GHOST} />
      <path d="M50 85 L35 96" {...DETAIL} />
      <path d="M50 85 L65 96" {...DETAIL} />
      <path d="M50 85 L50 98" {...DETAIL} />
    </>
  );
}

const ART: Record<string, () => React.JSX.Element> = {
  bike: Bike, car: Car, van: Van, microlight: Microlight, heli: Heli,
  multirotor: Multirotor, vtol: Vtol, apc: Apc, tracked: Tracked, hover: Hover,
  sportbike: Sportbike, coupe: Coupe, supercar: Supercar, jetski: Jetski,
  speedboat: Speedboat, cruiser: Cruiser, yacht: Yacht, gyro: Gyro,
  aerodyne: Aerodyne, aerodyne_delta: AerodyneDelta, airship: Airship,
};

/** Every shape the app can draw, for a hull picker to offer. */
export const ART_KEYS = Object.keys(ART);

/** The wireframe for a layout, as SVG children — the caller owns the <svg> and its size. */
export function VehicleArt({ layout }: { layout: string }) {
  const Draw = ART[layout] ?? Car;
  return <Draw />;
}
