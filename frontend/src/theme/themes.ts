import { createContext } from 'react';

export type ThemeName = 'classic' | 'vaporwave' | 'cyberpunk' | 'crimson' | 'ocean' | 'solar' | 'monochrome';

export interface ThemeColors {
  id: ThemeName;
  name: string;
  primary: string;
  friendly: string;
  danger: string;
  background: string;
  panelBg: string;
  glow: string;
  text: string;
  border: string;
  highlight: string;
  gridSection: string;
  gridCell: string;
}

export const THEMES: Record<ThemeName, ThemeColors> = {
  classic: {
    id: 'classic',
    name: 'Classic Hacker',
    primary: '#00ff00',
    friendly: '#0088ff',
    danger: '#ff3300',
    background: '#010502',
    panelBg: 'rgba(0, 20, 0, 0.85)',
    glow: '0 0 10px rgba(0, 255, 0, 0.7)',
    text: '#00ff00',
    border: '#004400',
    highlight: '#00ffaa',
    gridSection: '#0a2810',
    gridCell: '#041407'
  },
  vaporwave: {
    id: 'vaporwave',
    name: 'Vaporwave',
    primary: '#ff71ce',
    friendly: '#01cdfe',
    danger: '#ff1e1e',
    background: '#0c0516',
    panelBg: 'rgba(26, 11, 46, 0.85)',
    glow: '0 0 10px rgba(255, 113, 206, 0.7)',
    text: '#b967ff',
    border: '#4a154b',
    highlight: '#05ffa1',
    gridSection: '#3a1c50',
    gridCell: '#241033'
  },
  cyberpunk: {
    id: 'cyberpunk',
    name: 'Cyberpunk',
    primary: '#f3e600',
    friendly: '#00ff9f',
    danger: '#ff003c',
    background: '#060606',
    panelBg: 'rgba(13, 13, 13, 0.85)',
    glow: '0 0 10px rgba(243, 230, 0, 0.7)',
    text: '#00f0ff',
    border: '#f3e600',
    highlight: '#d100d1',
    gridSection: '#33300a',
    gridCell: '#1c1a05'
  },
  crimson: {
    id: 'crimson',
    name: 'Crimson',
    primary: '#ff3333',
    friendly: '#44aaff',
    danger: '#ff0000',
    background: '#080000',
    panelBg: 'rgba(20, 0, 0, 0.85)',
    glow: '0 0 10px rgba(255, 51, 51, 0.7)',
    text: '#ff8888',
    border: '#660000',
    highlight: '#ff5555',
    gridSection: '#4a0a0a',
    gridCell: '#280505'
  },
  ocean: {
    id: 'ocean',
    name: 'Oceanic',
    primary: '#00ffff',
    friendly: '#00ff88',
    danger: '#ff6666',
    background: '#000810',
    panelBg: 'rgba(0, 17, 34, 0.85)',
    glow: '0 0 10px rgba(0, 255, 255, 0.7)',
    text: '#88ccff',
    border: '#003366',
    highlight: '#00aaff',
    gridSection: '#0a3048',
    gridCell: '#051a28'
  },
  solar: {
    id: 'solar',
    name: 'Solar',
    primary: '#ffaa00',
    friendly: '#00ccff',
    danger: '#ff4400',
    background: '#100800',
    panelBg: 'rgba(34, 17, 0, 0.85)',
    glow: '0 0 10px rgba(255, 170, 0, 0.7)',
    text: '#ffdd88',
    border: '#663300',
    highlight: '#ffcc00',
    gridSection: '#42260a',
    gridCell: '#241505'
  },
  monochrome: {
    id: 'monochrome',
    name: 'Monochrome',
    primary: '#ffffff',
    friendly: '#cccccc',
    danger: '#666666',
    background: '#000000',
    panelBg: 'rgba(10, 10, 10, 0.85)',
    glow: '0 0 10px rgba(255, 255, 255, 0.5)',
    text: '#eeeeee',
    border: '#333333',
    highlight: '#ffffff',
    gridSection: '#2e2e2e',
    gridCell: '#191919'
  }
};

export const ThemeContext = createContext<ThemeColors>(THEMES.classic);
