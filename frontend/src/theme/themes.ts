import { createContext } from 'react';

export type ThemeName = 'classic' | 'vaporwave' | 'cyberpunk' | 'crimson' | 'ocean' | 'solar' | 'monochrome';

export interface ThemeColors {
  name: string;
  primary: string;
  friendly: string;
  danger: string;
  background: string;
  panelBg: string;
  text: string;
  border: string;
  highlight: string;
}

export const THEMES: Record<ThemeName, ThemeColors> = {
  classic: {
    name: 'Classic Hacker',
    primary: '#00ff00',
    friendly: '#0088ff',
    danger: '#ff3300',
    background: '#0a1a0f',
    panelBg: 'rgba(0, 20, 0, 0.85)',
    text: '#00ff00',
    border: '#004400',
    highlight: '#00ffaa'
  },
  vaporwave: {
    name: 'Vaporwave',
    primary: '#ff71ce',
    friendly: '#01cdfe',
    danger: '#ff1e1e',
    background: '#1a0b2e',
    panelBg: 'rgba(26, 11, 46, 0.85)',
    text: '#b967ff',
    border: '#4a154b',
    highlight: '#05ffa1'
  },
  cyberpunk: {
    name: 'Cyberpunk',
    primary: '#f3e600',
    friendly: '#00ff9f',
    danger: '#ff003c',
    background: '#0d0d0d',
    panelBg: 'rgba(13, 13, 13, 0.85)',
    text: '#00f0ff',
    border: '#f3e600',
    highlight: '#d100d1'
  },
  crimson: {
    name: 'Crimson',
    primary: '#ff3333',
    friendly: '#44aaff',
    danger: '#ff0000',
    background: '#110000',
    panelBg: 'rgba(20, 0, 0, 0.85)',
    text: '#ff8888',
    border: '#660000',
    highlight: '#ff5555'
  },
  ocean: {
    name: 'Oceanic',
    primary: '#00ffff',
    friendly: '#00ff88',
    danger: '#ff6666',
    background: '#001122',
    panelBg: 'rgba(0, 17, 34, 0.85)',
    text: '#88ccff',
    border: '#003366',
    highlight: '#00aaff'
  },
  solar: {
    name: 'Solar',
    primary: '#ffaa00',
    friendly: '#00ccff',
    danger: '#ff4400',
    background: '#221100',
    panelBg: 'rgba(34, 17, 0, 0.85)',
    text: '#ffdd88',
    border: '#663300',
    highlight: '#ffcc00'
  },
  monochrome: {
    name: 'Monochrome',
    primary: '#ffffff',
    friendly: '#cccccc',
    danger: '#666666',
    background: '#000000',
    panelBg: 'rgba(10, 10, 10, 0.85)',
    text: '#eeeeee',
    border: '#333333',
    highlight: '#ffffff'
  }
};

export const ThemeContext = createContext<ThemeColors>(THEMES.classic);
