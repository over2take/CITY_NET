import { createContext } from 'react';

export type ThemeName = 
  | 'classic'
  | 'vaporwave'
  | 'cyberpunk'
  | 'crimson'
  | 'deep_space'
  | 'high_contrast'
  | 'sepia';

export interface ThemePalette {
  name: string;
  id: ThemeName;
  primary: string;       // Used for text, borders, main 3D meshes
  background: string;    // Used for app background
  panelBg: string;       // Used for panels/modals (often with opacity)
  glow: string;          // Used for text-shadow and box-shadow
  danger: string;        // Used for enemies, warnings
  friendly: string;      // Used for allies, success
}

export const THEMES: Record<ThemeName, ThemePalette> = {
  classic: {
    name: 'Classic Terminal',
    id: 'classic',
    primary: '#00ff00',
    background: '#000000',
    panelBg: 'rgba(0, 20, 0, 0.8)',
    glow: '0 0 10px rgba(0, 255, 0, 0.7)',
    danger: '#ff0000',
    friendly: '#0088ff'
  },
  vaporwave: {
    name: 'Vaporwave',
    id: 'vaporwave',
    primary: '#ff00ff', // Hot pink
    background: '#0a0a2a', // Deep purple/blue
    panelBg: 'rgba(20, 0, 40, 0.8)',
    glow: '0 0 10px rgba(255, 0, 255, 0.7)',
    danger: '#ff3300',
    friendly: '#00ffff' // Cyan
  },
  cyberpunk: {
    name: 'Cyberpunk',
    id: 'cyberpunk',
    primary: '#fce300', // Neon yellow
    background: '#121212',
    panelBg: 'rgba(20, 20, 20, 0.85)',
    glow: '0 0 10px rgba(252, 227, 0, 0.7)',
    danger: '#ff003c',
    friendly: '#04d9ff'
  },
  crimson: {
    name: 'Crimson / Blood Moon',
    id: 'crimson',
    primary: '#ff3333',
    background: '#050000',
    panelBg: 'rgba(40, 0, 0, 0.8)',
    glow: '0 0 10px rgba(255, 0, 0, 0.7)',
    danger: '#ff0000',
    friendly: '#ffaa00'
  },
  deep_space: {
    name: 'Deep Space',
    id: 'deep_space',
    primary: '#ffffff', // Starlight white
    background: '#02040a', // Void black/blue
    panelBg: 'rgba(10, 15, 30, 0.8)',
    glow: '0 0 10px rgba(100, 150, 255, 0.5)',
    danger: '#ff4444',
    friendly: '#00ccff'
  },
  high_contrast: {
    name: 'High Contrast',
    id: 'high_contrast',
    primary: '#ffffff',
    background: '#000000',
    panelBg: 'rgba(0, 0, 0, 0.95)',
    glow: 'none',
    danger: '#ff0000',
    friendly: '#0000ff'
  },
  sepia: {
    name: 'Sepia / Noir',
    id: 'sepia',
    primary: '#d4b886', // Warm vintage tan
    background: '#1c1814', // Very dark brown
    panelBg: 'rgba(40, 30, 20, 0.8)',
    glow: '0 0 5px rgba(212, 184, 134, 0.4)',
    danger: '#a33b3b',
    friendly: '#5c7a5c'
  }
};

export const ThemeContext = createContext<ThemePalette>(THEMES.classic);
