import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { Sidebar, CharacterControlsMenu } from '../Sidebar';
import { SheetRenderer } from '../SheetRenderer';
import { HitPointsPanel } from '../HitPoints';
import { ModelHealthEditor } from '../HealthModelPanels';
import { TokenWindow } from '../TokenWindow';
import { getTemplate } from '../../sheets';
import { registerCustomTemplate, clearCustomTemplates, type CustomRender } from '../../sheets/customTemplates';
import { asLabel, wordFor } from '../../sheets/words';

/**
 * The glossary in the sheet, token and health windows (3a3). Every place reads exactly as
 * today under each built-in system, and under a custom system that did not rename the term; a
 * custom system that did rename it shows its own word, in the terminal-label style where the
 * place uses one (VIEW_BANK becomes VIEW_COIN_PURSE).
 */

const BUILT_INS = ['cities_without_number', 'cyberpunk_red', 'shadowrun_6e', 'generic'];
const RENAMED = 'sys_aaaaaaaaaaaaaaaa';
const PLAIN = 'sys_bbbbbbbbbbbbbbbb';
const both = (w: string) => ({ singular: w, plural: w, short: w });
const custom = (id: string, words: CustomRender['words']): CustomRender => ({
  id, name: id, parts: {}, derived: [], words,
  sheet: {
    header: { nameField: 'name', hpField: 'hp', hpMaxField: 'hp_max' },
    sections: [{ id: 'h', label: 'H', layout: 'grid', fields: [
      { id: 'hp', label: 'HP', type: 'number', source: 'token_hp', maxField: 'hp_max' },
      { id: 'hp_max', label: 'MAX', type: 'number', source: 'token_hp_max' },
    ] }],
  },
});

beforeEach(() => {
  clearCustomTemplates();
  registerCustomTemplate(custom(RENAMED, {
    hp: { singular: 'WOUND', plural: 'WOUNDS', short: 'WND' },
    character: both('OPERATIVE'),
    gm: both('WARDEN'),
    initiative: { singular: 'ORDER', plural: 'ORDER', short: 'ORD' },
  }));
  registerCustomTemplate(custom(PLAIN, {}));
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve([]) } as Response)));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('the label style', () => {
  it('capitals, with spaces to underscores', () => {
    expect(asLabel('HIT POINTS')).toBe('HIT_POINTS');
    expect(asLabel(' coin  purse ')).toBe('COIN_PURSE');
    expect(asLabel('WOUNDS')).toBe('WOUNDS');
  });
});

describe('the sidebar', () => {
  const rail = (gameSystem: string) => {
    const props: any = {
      activeMenu: 'none', setActiveMenu: vi.fn(), locations: [], onSelect: vi.fn(), onZoom: vi.fn(), selectedLocation: null,
      userName: 'GHOST', token: '', onLogout: vi.fn(), audioEnabled: false, setAudioEnabled: vi.fn(), masterVolume: 1,
      setMasterVolume: vi.fn(), musicVolume: 1, setMusicVolume: vi.fn(), rhombusState: { color: '#00ff00' }, setRhombusState: vi.fn(),
      refreshLocations: vi.fn(), socketRef: { current: { on: vi.fn(), off: vi.fn(), emit: vi.fn() } }, isChatOpen: false,
      setIsChatOpen: vi.fn(), hasUnreadChat: false, syncRhombusToDB: vi.fn(), view: 'list', activeBattleMapData: null,
      isHitPointsOpen: false, setIsHitPointsOpen: vi.fn(), activeUsers: [], setIsDiceTrayOpen: vi.fn(), setNotification: vi.fn(),
      measureMode: false, setMeasureMode: vi.fn(), isBankOpen: false, setIsBankOpen: vi.fn(), isSheetOpen: false,
      setIsSheetOpen: vi.fn(), gameSystem,
    };
    render(<Sidebar {...props} />);
    const label = (name: string) => screen.queryByRole('button', { name })?.getAttribute('data-tip');
    const out = { hp: label(gameSystem === RENAMED ? 'WOUNDS' : 'HIT_POINTS'), controls: label(gameSystem === RENAMED ? 'OPERATIVE_CONTROLS' : 'CHARACTER_CONTROLS') };
    cleanup();
    return out;
  };

  it('reads as today under every built-in system, and a custom one that renamed nothing', () => {
    for (const system of [...BUILT_INS, PLAIN]) expect(rail(system), system).toEqual({ hp: 'HIT_POINTS', controls: 'CHARACTER_CONTROLS' });
  });

  it('uses a custom system\'s own words, in the label style', () => {
    expect(rail(RENAMED)).toEqual({ hp: 'WOUNDS', controls: 'OPERATIVE_CONTROLS' });
  });

  it('heads the controls menu the same way', () => {
    const menu = (gameSystem: string) => {
      render(<CharacterControlsMenu rhombusState={{ color: '#00ff00' } as never} setRhombusState={vi.fn()} selectedLocation={null} setSelectedLocation={vi.fn()} refreshLocations={vi.fn()} token="" userName="GHOST" locations={[]} socketRef={{ current: { on: vi.fn(), off: vi.fn(), emit: vi.fn() } } as never} syncRhombusToDB={vi.fn()} view="list" activeBattleMapData={null} measureMode={false} setMeasureMode={vi.fn()} gameSystem={gameSystem} />);
      const text = screen.getByRole('heading', { level: 3 }).textContent;
      cleanup();
      return text;
    };
    for (const system of [...BUILT_INS, PLAIN]) expect(menu(system), system).toBe('CHARACTER_CONTROLS');
    expect(menu(RENAMED)).toBe('OPERATIVE_CONTROLS');
  });
});

describe('the sheet header', () => {
  const header = (system: string) => {
    const template = getTemplate(system);
    const { container } = render(<SheetRenderer template={template} data={{ hp: 5, hp_max: 10 } as never} onFieldChange={vi.fn()} onOpenLink={vi.fn()} />);
    const bar = container.querySelector('[title^="Synced with your token"]') as HTMLElement;
    const out = { label: bar.querySelector('span')!.textContent, tip: bar.getAttribute('title') };
    cleanup();
    return out;
  };

  it('reads as today under every built-in system, and a custom one that renamed nothing', () => {
    for (const system of [...BUILT_INS, PLAIN]) {
      expect(header(system), system).toEqual({ label: 'HP', tip: 'Synced with your token — click to open HIT_POINTS' });
    }
  });

  it('names a custom system\'s own hit points, and the same button the sidebar shows', () => {
    expect(header(RENAMED)).toEqual({ label: 'WND', tip: 'Synced with your token — click to open WOUNDS' });
  });
});

describe('the HEALTH folder', () => {
  const token = { id: 7, name: 'Razor', x: 0, y: 0, z: 0, shape: 'rhombus', owner: 'RAZOR', hp_current: 8, hp_max: 10, hp_temp: 0 } as never;
  const labels = (gameSystem: string) => {
    render(<HitPointsPanel target={token} token="gm" refreshLocations={vi.fn()} gameSystem={gameSystem} />);
    const out = {
      temp: screen.getByText(/^TEMP_/).textContent,
      max: screen.getByText(/^MAX_/).textContent,
      tempAria: screen.getByLabelText(/^Temp /).getAttribute('aria-label'),
      maxAria: screen.getByLabelText(/^Max /).getAttribute('aria-label'),
    };
    cleanup();
    return out;
  };

  it('reads as today under every built-in system, and a custom one that renamed nothing', () => {
    for (const system of [...BUILT_INS, PLAIN]) {
      expect(labels(system), system).toEqual({ temp: 'TEMP_HP', max: 'MAX_HP', tempAria: 'Temp HP', maxAria: 'Max HP' });
    }
  });

  it('uses a custom system\'s own word', () => {
    expect(labels(RENAMED)).toEqual({ temp: 'TEMP_WOUNDS', max: 'MAX_WOUNDS', tempAria: 'Temp WOUNDS', maxAria: 'Max WOUNDS' });
  });

  it('names the hit-location model\'s pool the same way', () => {
    const view = { location_id: 7, model: 'locations' as const, full: true, locations: [{ id: 'head', label: 'HEAD', note: '' }] };
    render(<ModelHealthEditor view={view} target={token} send={vi.fn()} gm />);
    expect(screen.getByText('HP')).toBeTruthy();
    expect(screen.getByLabelText('MAX_HP')).toBeTruthy();
    cleanup();
    render(<ModelHealthEditor view={view} target={token} send={vi.fn()} gm words={(t, f, b) => wordFor(RENAMED, t, f, b)} />);
    expect(screen.getByText('WND')).toBeTruthy();
    expect(screen.getByLabelText('MAX_WOUNDS')).toBeTruthy();
  });
});

describe('the token window', () => {
  const npc = { id: 9, name: 'Ghoul', shape: 'enemy_rhombus' };
  const open = (gameSystem: string) => {
    render(
      <TokenWindow location={npc} title="ID.EXE · GHOUL" pos={{ x: 0, y: 0 }} setPos={vi.fn()} onClose={vi.fn()} portrait={null}
        description="" actions={[]} operator={null} socket={{ on: vi.fn(), off: vi.fn(), emit: vi.fn() }} health={<div />}
        gmHealth={{ defense: { label: 'AC', melee: 10, ranged: null }, onSaveDefense: vi.fn(), onAddToInit: vi.fn() }}
        gmNotesToken="gm-token" gameSystem={gameSystem} />,
    );
    fireEvent.click(screen.getByRole('tab', { name: 'HEALTH' }));
    const out: Record<string, string | null> = {
      score: screen.getByText(/ SCORE$/).textContent,
      add: screen.getByRole('button', { name: /^ADD TO / }).textContent,
      aria: screen.getByLabelText(/ score$/).getAttribute('aria-label'),
      folder: screen.getAllByRole('tab').map((t) => t.textContent).find((t) => t?.endsWith(' NOTES')) ?? null,
    };
    fireEvent.click(screen.getByRole('tab', { name: out.folder! }));
    out.header = screen.getByText(/ ONLY · PLAYERS NEVER SEE THIS$/).textContent;
    cleanup();
    return out;
  };

  it('reads as today under every built-in system, and a custom one that renamed nothing', () => {
    for (const system of [...BUILT_INS, PLAIN, undefined as unknown as string]) {
      expect(open(system), String(system)).toEqual({
        score: 'INITIATIVE SCORE', add: 'ADD TO INIT', aria: 'Initiative score', folder: 'GM NOTES', header: 'GM ONLY · PLAYERS NEVER SEE THIS',
      });
    }
  });

  it('uses a custom system\'s own words for the GM and initiative', () => {
    expect(open(RENAMED)).toEqual({
      score: 'ORDER SCORE', add: 'ADD TO ORD', aria: 'ORDER score', folder: 'WARDEN NOTES', header: 'WARDEN ONLY · PLAYERS NEVER SEE THIS',
    });
  });
});
