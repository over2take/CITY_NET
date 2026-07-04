import { describe, it, expect } from 'vitest';
import { THEMES, ThemeContext } from '../themes';

const REQUIRED_FIELDS = ['name', 'id', 'primary', 'background', 'panelBg', 'glow', 'danger', 'friendly'] as const;
const THEME_IDS = ['classic', 'vaporwave', 'cyberpunk', 'crimson', 'deep_space', 'high_contrast', 'sepia'] as const;

describe('THEMES palette', () => {
  it('exports exactly the expected theme IDs', () => {
    expect(Object.keys(THEMES).sort()).toEqual([...THEME_IDS].sort());
  });

  THEME_IDS.forEach((id) => {
    describe(`${id}`, () => {
      it('has all required fields defined and non-empty', () => {
        const theme = THEMES[id];
        REQUIRED_FIELDS.forEach((field) => {
          expect(theme[field], `${id}.${field} must be defined`).toBeDefined();
          expect(theme[field], `${id}.${field} must be non-empty`).not.toBe('');
        });
      });

      it('id field matches its key in THEMES', () => {
        expect(THEMES[id].id).toBe(id);
      });

      it('primary, background, danger, friendly are valid CSS color strings', () => {
        const theme = THEMES[id];
        const cssColor = /^(#[0-9a-fA-F]{3,8}|rgba?\(|hsla?\()/;
        (['primary', 'background', 'danger', 'friendly'] as const).forEach((field) => {
          expect(theme[field]).toMatch(cssColor);
        });
      });

      it('panelBg is a CSS color or rgba string', () => {
        expect(THEMES[id].panelBg).toMatch(/^(rgba?\(|#)/);
      });
    });
  });
});

describe('ThemeContext', () => {
  it('default value is the classic theme', () => {
    expect(ThemeContext).toBeDefined();
    // Context default is set to THEMES.classic in themes.ts
    const defaultValue = (ThemeContext as any)._currentValue;
    expect(defaultValue.id).toBe('classic');
  });
});
