import { createContext, useContext } from 'react';
import { ALL_VISIBLE } from '../types';
import type { StreamerVisibility } from '../types';

// Streamer mode layer toggles. Defaults to all-visible, so components that
// read this behave identically outside the spectator window.
export const StreamerVisibilityContext = createContext<StreamerVisibility>(ALL_VISIBLE);

export const useStreamerVisibility = () => useContext(StreamerVisibilityContext);
