import React, { useState, useEffect, memo } from 'react';

const messages = [
  "SCANNING FOR LOCATIONS...",
  "CONNECTING TO DATA_LINK...",
  "SYNCING CITY_NET...",
  "SYSTEM_CALIBRATION...",
  "SCANNING SECTOR GRID...",
  "PINGING NODE CLUSTERS...",
  "QUERYING BLACKNET REGISTRY...",
  "TRACING SIGNAL ORIGIN...",
  "SWEEPING ENCRYPTED CHANNELS...",
  "LOCATING GHOST SIGNATURES...",
  "PROBING SUBNET_7_OMEGA...",
  "DECRYPTING LOCATION HASH...",
  "TRIANGULATING UPLINK SOURCE...",
  "MAPPING DEAD ZONES...",
  "SYNCING NEURAL MAP DATA...",
  "PATCHING SECTOR BOUNDARIES...",
  "UPLOADING STREET_LEVEL OVERLAYS...",
  "INJECTING LIVE FEED COORDINATES...",
  "FLUSHING STALE CACHE...",
  "REWRITING DISTRICT MANIFESTS...",
  "PUSHING ENCRYPTED WAYPOINTS...",
  "CALIBRATING GRID ALIGNMENT...",
  "OVERWRITING CORRUPTED NODES...",
  "MERGING FRAGMENTED DATA_STREAMS...",
  "ANALYZING THREAT VECTORS...",
  "CROSS_REFERENCING KNOWN ALIASES...",
  "RUNNING PROBABILITY CASCADE...",
  "CALCULATING OPTIMAL ROUTE...",
  "WEIGHING EXTRACTION OPTIONS...",
  "PROCESSING INTERCEPTED INTEL...",
  "CORRELATING SIGNAL PATTERNS...",
  "SIMULATING BREACH SCENARIOS...",
  "EVALUATING HOSTILE PRESENCE...",
  "RECONSTRUCTING TIMELINE FRAGMENTS...",
];

function useTypewriter() {
  const [statusText, setStatusText] = useState('');
  const [statusHistory, setStatusHistory] = useState<string[]>([]);
  const [messageIndex, setMessageIndex] = useState(0);
  const [charIndex, setCharIndex] = useState(0);
  const [isWaiting, setIsWaiting] = useState(false);
  const [throbber, setThrobber] = useState('');

  useEffect(() => {
    const typeSpeed = 50;
    const waitTime = 2000;
    const throbbers = ['|', '/', '-', '\\'];

    if (isWaiting) {
      setThrobber('');
      const timer = setTimeout(() => {
        setIsWaiting(false);
        setCharIndex(0);
        setStatusHistory(prev => [...prev, messages[messageIndex]].slice(-4));
        setStatusText('');
        let nextIndex;
        do { nextIndex = Math.floor(Math.random() * messages.length); }
        while (messages.length > 1 && nextIndex === messageIndex);
        setMessageIndex(nextIndex);
      }, waitTime);
      return () => clearTimeout(timer);
    }

    const timer = setTimeout(() => {
      setThrobber(throbbers[Math.floor(Date.now() / 200) % throbbers.length]);
      const currentMessage = messages[messageIndex];
      if (charIndex < currentMessage.length) {
        setStatusText(prev => prev + currentMessage[charIndex]);
        setCharIndex(prev => prev + 1);
      } else {
        setIsWaiting(true);
      }
    }, typeSpeed);
    return () => clearTimeout(timer);
  }, [charIndex, isWaiting, messageIndex]);

  return { statusText, statusHistory, isWaiting, throbber };
}

export const StatusLogDisplay = memo(function StatusLogDisplay() {
  const { statusText, statusHistory, isWaiting, throbber } = useTypewriter();
  return (
    <div className="status-log-container">
      {statusHistory.map((msg, i) => <div key={i} className="status-line old-line">{msg}</div>)}
      <div className="status-line current-line">
        {isWaiting ? 'SYSTEM READY // ' : `SYSTEM CHECKING ${throbber} // `}{statusText}
      </div>
    </div>
  );
});

export const StatusBarText = memo(function StatusBarText() {
  const { statusText, isWaiting, throbber } = useTypewriter();
  return (
    <>
      <span style={{ display: 'inline-block', width: '250px', textAlign: 'right' }}>
        {isWaiting ? 'SYSTEM READY // ' : `SYSTEM CHECKING ${throbber} // `}
      </span>
      <span style={{ display: 'inline-block', width: '300px', textAlign: 'left', whiteSpace: 'nowrap' }}>
        {statusText}
      </span>
    </>
  );
});
