import React from 'react';

/**
 * "This character is in a vehicle" — on the sheet and on the token menu.
 *
 * Inline rather than an imported .svg so it takes the theme through `currentColor`, the
 * same reason the person and eye icons are inline.
 *
 * Clicking it gets you out. Only your own, unless you are the GM: that is checked on the
 * server too, and the button is inert rather than hidden for anyone else, because seeing
 * that someone is in a car is the point of the badge.
 */

export const CarSVG = ({ size = 16 }: { size?: number }) => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width={size} height={size} aria-hidden="true">
    <path
      fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth={32}
      d="M469.71 234.6c-7.33-9.73-34.56-16.43-46.08-33.94s-20.95-55.43-50.27-70S288 112 256 112s-88 4-117.36 18.63s-38.75 52.52-50.27 70s-38.75 24.24-46.08 33.97S29.8 305.84 32.94 336s9 48 9 48h86c14.08 0 18.66-5.29 47.46-8c31.6-3 62.6-4 80.6-4s50 1 81.58 4c28.8 2.73 33.53 8 47.46 8h85s5.86-17.84 9-48s-2.04-91.67-9.33-101.4M400 384h56v16h-56zm-344 0h56v16H56z"
    />
    <path
      fill="currentColor"
      d="M364.47 309.16c-5.91-6.83-25.17-12.53-50.67-16.35S279 288 256.2 288s-33.17 1.64-57.61 4.81s-42.79 8.81-50.66 16.35C136.12 320.6 153.42 333.44 167 335c13.16 1.5 39.47.95 89.31.95s76.15.55 89.31-.95c13.56-1.65 29.62-13.6 18.85-25.84m67.1-66.11a3.23 3.23 0 0 0-3.1-3c-11.81-.42-23.8.42-45.07 6.69a93.9 93.9 0 0 0-30.08 15.06c-2.28 1.78-1.47 6.59 1.39 7.1a455 455 0 0 0 52.82 3.1c10.59 0 21.52-3 23.55-12.44a52.4 52.4 0 0 0 .49-16.51m-351.14 0a3.23 3.23 0 0 1 3.1-3c11.81-.42 23.8.42 45.07 6.69a93.9 93.9 0 0 1 30.08 15.06c2.28 1.78 1.47 6.59-1.39 7.1a455 455 0 0 1-52.82 3.1c-10.59 0-21.52-3-23.55-12.44a52.4 52.4 0 0 1-.49-16.51"
    />
    <path
      fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth={32}
      d="M432 192h16m-384 0h16m-2 19s46.35-12 178-12s178 12 178 12"
    />
  </svg>
);

interface Props {
  /** The vehicle they are in, as the token or sheet knows it. Null hides the badge. */
  vehicle: { name: string; moving?: boolean } | null | undefined;
  /** Who is in it — the person this badge belongs to. */
  occupant: string;
  userName: string;
  isAdmin?: boolean;
  /** Take them out. Only called when the click is allowed. */
  onDisembark: (occupant: string) => void;
  compact?: boolean;
}

export function VehicleBadgeButton({ vehicle, occupant, userName, isAdmin, onDisembark, compact }: Props) {
  if (!vehicle) return null;
  const mine = occupant === userName || !!isAdmin;
  const label = `${vehicle.name.toUpperCase()}${vehicle.moving ? ' · MOVING' : ''}`;

  return (
    <button
      type="button"
      disabled={!mine}
      onClick={() => mine && onDisembark(occupant)}
      title={mine ? `Get out of the ${vehicle.name}` : `In the ${vehicle.name}`}
      aria-label={mine ? `Get out of the ${vehicle.name}` : `In the ${vehicle.name}`}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: '5px',
        fontFamily: 'inherit', fontSize: compact ? '0.55rem' : '0.62rem',
        letterSpacing: '1px', padding: compact ? '1px 5px' : '2px 6px',
        color: 'var(--vehicle)',
        // Compact means the sheet's title bar, which is painted in the theme colour — an
        // outline in another theme colour on top of it is hard to read, and in monochrome
        // the badge disappears into the bar entirely. It sits on black there, the way the
        // buttons beside it already do.
        background: compact ? 'var(--black)' : 'none',
        border: compact ? '1px solid var(--black)' : '1px solid var(--vehicle)',
        // Inert for someone else's badge rather than hidden: knowing they are in a car is
        // the reason it is on the token menu at all.
        cursor: mine ? 'pointer' : 'default',
        opacity: mine ? 1 : 0.65,
      }}
    >
      <CarSVG size={compact ? 12 : 14} />
      {label}
    </button>
  );
}
