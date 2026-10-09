import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, within, waitFor } from '@testing-library/react';
import { createRequire } from 'module';

vi.mock('@react-three/fiber', () => ({
  useFrame: vi.fn(),
  useThree: () => ({ controls: { enabled: true }, raycaster: { ray: { intersectPlane: vi.fn() } } }),
}));
vi.mock('@react-three/drei', () => ({ Html: ({ children }: any) => <div>{children}</div> }));
vi.mock('../../HealthBar', () => ({ HealthBar: () => <div data-testid="health-bar" /> }));

import { EnemyRhombus, FriendlyRhombus, PlayerRhombus } from '../Rhombuses';
import { forgetConditionLists, CONDITIONS_CHANGED_EVENT } from '../../hooks/useConditionList';
import { registerCustomTemplate, clearCustomTemplates } from '../../sheets/customTemplates';

/**
 * Conditions on the map (4e2b2). Approved mockup builder-conditions (2026-10-09): up to four icons
 * above a token, then +N listing the rest when pointed at; for everyone, enemies included, and in
 * a game with token health off too, since it may track harm in conditions alone. Every token draws
 * from one shared request for the game's list.
 */

const { conditionsOf } = createRequire(import.meta.url)('../../../../backend/systemBuilder/conditions.js');
const HEARTH = 'sys_aaaaaaaaaaaaaaaa';
const GAME = conditionsOf({ conditions: { glitching: { name: 'Glitching', icon: 'signal' } } });

let asked: string[];
beforeEach(() => {
  asked = [];
  forgetConditionLists();
  clearCustomTemplates();
  // Token health off: conditions still show.
  registerCustomTemplate({ id: HEARTH, name: 'Hearth', parts: { token_health: { on: false } }, derived: [], sheet: { sections: [] }, words: {} });
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    asked.push(String(input));
    return { ok: true, status: 200, json: async () => GAME } as Response;
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); clearCustomTemplates(); });

const socket = () => ({ emit: vi.fn(), on: vi.fn(), off: vi.fn() });
const loc = (id: number, shape: string, conditions: unknown[]): any => ({
  id, x: 0, y: 0, z: 0, width: 1, height: 1, depth: 1, name: 'X', color: '#00ff00', shape, hp_current: 10, hp_max: 10, hp_temp: 0, owner: 'GHOST',
  conditions: JSON.stringify(conditions),
});
const common = (gameSystem = HEARTH) => ({ onClick: vi.fn(), isSelected: false, setTargetObject: vi.fn(), refreshLocations: vi.fn(), setIsDragging: vi.fn(),
  socket: socket(), roads: [], isBattleMap: false, measureMode: false, gameSystem });

describe('a token\'s condition icons', () => {
  it('draws up to four, then +N naming the rest, each named when pointed at', async () => {
    const six = ['blinded', 'bleeding', 'poisoned', 'prone', 'stunned', 'glitching'].map((id) => ({ id }));
    render(<EnemyRhombus location={loc(1, 'enemy_rhombus', six)} token="" {...common()} />);
    const icons = await screen.findByTestId('map-conditions');
    const marks = within(icons).getAllByTitle(/./);
    expect(marks.map((m) => m.getAttribute('title')).filter((t, i, all) => all.indexOf(t) === i)).toEqual(['Blinded', 'Bleeding', 'Poisoned', 'Prone', 'Stunned, Glitching']);
    expect(within(icons).getByText('+2').getAttribute('title')).toBe('Stunned, Glitching');
    expect(icons.querySelectorAll('svg')).toHaveLength(4);
  });

  it('shows on every kind of token to anyone, enemies included, with token health off', async () => {
    render(<>
      <EnemyRhombus location={loc(1, 'enemy_rhombus', [{ id: 'prone' }])} token="" {...common()} />
      <FriendlyRhombus location={loc(2, 'friendly_rhombus', [{ id: 'glitching' }])} token="" userName="vex" {...common()} />
      <PlayerRhombus location={loc(3, 'rhombus', [{ id: 'bleeding', left: 2 }])} token="" userName="vex" activeUsers={[]} {...common()} />
    </>);
    await waitFor(() => expect(screen.getAllByTestId('map-conditions')).toHaveLength(3));
    expect(screen.queryAllByTestId('health-bar')).toHaveLength(0);
  });

  it('draws nothing for a token with none, or only ones the game no longer has', async () => {
    render(<>
      <EnemyRhombus location={loc(1, 'enemy_rhombus', [])} token="" {...common()} />
      <EnemyRhombus location={loc(2, 'enemy_rhombus', [{ id: 'hungry' }])} token="" {...common()} />
    </>);
    await waitFor(() => expect(asked.length).toBeGreaterThan(0));
    await new Promise((r) => setTimeout(r, 10));
    expect(screen.queryAllByTestId('map-conditions')).toHaveLength(0);
  });

  it('asks for the game\'s list once for every token, and again when a published system changes', async () => {
    render(<>
      {[1, 2, 3, 4, 5].map((id) => <EnemyRhombus key={id} location={loc(id, 'enemy_rhombus', [{ id: 'prone' }])} token="" {...common()} />)}
    </>);
    await waitFor(() => expect(screen.getAllByTestId('map-conditions')).toHaveLength(5));
    expect(asked).toEqual([`/api/systems/conditions/${HEARTH}`]);
    window.dispatchEvent(new Event(CONDITIONS_CHANGED_EVENT));
    await waitFor(() => expect(asked).toHaveLength(2));
    await new Promise((r) => setTimeout(r, 10));
    expect(asked).toHaveLength(2);
  });

  it('asks again after a request that failed, rather than keeping nothing', async () => {
    let fail = true;
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      asked.push(String(input));
      return (fail ? { ok: false, status: 500, json: async () => ({}) } : { ok: true, status: 200, json: async () => GAME }) as Response;
    }));
    const { unmount } = render(<EnemyRhombus location={loc(1, 'enemy_rhombus', [{ id: 'prone' }])} token="" {...common()} />);
    await waitFor(() => expect(asked).toHaveLength(1));
    expect(screen.queryByTestId('map-conditions')).toBeNull();
    unmount();
    fail = false;
    render(<EnemyRhombus location={loc(1, 'enemy_rhombus', [{ id: 'prone' }])} token="" {...common()} />);
    expect(await screen.findByTestId('map-conditions')).toBeTruthy();
    expect(asked).toHaveLength(2);
  });
});
