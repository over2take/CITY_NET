import React from 'react';

// Glitchy TV/CRT portrait effect: chromatic R/B fringe layers, scanlines,
// rolling refresh band, and an intermittent glitch jitter. Self-contained —
// carries its own CSS and SVG filters so it works anywhere a portrait is
// shown (sheets, token windows, ...). Fills its parent; give the parent
// position:relative and an explicit size.
export function TvPortrait({ src }: { src: string }) {
  const imgStyle: React.CSSProperties = {
    position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover',
  };
  return (
    <div className="portrait-tv" style={{ position: 'absolute', inset: 0 }}>
      <style>{`
        .portrait-tv { animation: portrait-glitch 4s infinite steps(1); }
        @keyframes portrait-glitch {
          0%, 91% { transform: none; filter: none; }
          92% { transform: translateX(2px) skewX(-1deg); }
          93% { transform: translateX(-2px); filter: brightness(1.3); }
          94% { transform: translateX(1px) skewX(0.5deg); }
          95%, 100% { transform: none; filter: none; }
        }
        .portrait-scanlines {
          position: absolute; inset: 0; pointer-events: none;
          background: repeating-linear-gradient(
            to bottom,
            rgba(0, 0, 0, 0) 0px, rgba(0, 0, 0, 0) 2px,
            rgba(0, 0, 0, 0.28) 2px, rgba(0, 0, 0, 0.28) 3px
          );
        }
        .portrait-rollband {
          position: absolute; left: 0; right: 0; height: 22%; pointer-events: none;
          background: linear-gradient(to bottom, rgba(255,255,255,0) 0%, rgba(255,255,255,0.07) 50%, rgba(255,255,255,0) 100%);
          animation: portrait-roll 6s linear infinite;
        }
        @keyframes portrait-roll {
          from { top: -25%; }
          to { top: 105%; }
        }
      `}</style>
      {/* Chromatic fringe: R and B copies offset either side of the base */}
      <img src={src} alt="" aria-hidden style={{ ...imgStyle, filter: 'url(#portrait-red)', transform: 'translateX(1.5px)', mixBlendMode: 'screen', opacity: 0.85 }} />
      <img src={src} alt="" aria-hidden style={{ ...imgStyle, filter: 'url(#portrait-blue)', transform: 'translateX(-1.5px)', mixBlendMode: 'screen', opacity: 0.85 }} />
      <img src={src} alt="portrait" style={{ ...imgStyle, mixBlendMode: 'screen' }} />
      {/* Scanlines + rolling refresh band */}
      <div className="portrait-scanlines" />
      <div className="portrait-rollband" />
      {/* SVG color-isolation filters for the fringe layers */}
      <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden>
        <filter id="portrait-red"><feColorMatrix type="matrix" values="1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0" /></filter>
        <filter id="portrait-blue"><feColorMatrix type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0" /></filter>
      </svg>
    </div>
  );
}
