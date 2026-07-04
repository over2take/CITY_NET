// Loads remote font files into the browser's FontFace registry so they work
// inside canvas contexts. Results are cached by URL so each font loads once.

const loaded = new Map<string, Promise<void>>();

export const loadFont = (family: string, url: string): Promise<void> => {
  if (loaded.has(url)) return loaded.get(url)!;
  const p = new FontFace(family, `url(${url})`).load().then(face => {
    document.fonts.add(face);
  });
  loaded.set(url, p);
  return p;
};

export interface RemoteFont {
  name: string;
  file: string;
  url: string;
}

export const BUILTIN_FONTS = [
  { label: 'Monospace', value: 'monospace' },
  { label: 'Courier New', value: "'Courier New'" },
  { label: 'Sans-Serif', value: 'sans-serif' },
  { label: 'Serif', value: 'serif' },
  { label: 'Arial Black', value: "'Arial Black'" },
];
