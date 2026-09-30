import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { SheetRenderer } from '../../components/SheetRenderer';
import { NpcSheetWindow } from '../../components/NpcSheetWindow';
import {
  templateFromRender, registerCustomTemplate, clearCustomTemplates, npcTemplateOf, type CustomRender,
} from '../customTemplates';
import { getTemplate } from '../index';

/**
 * A custom system's GM-only fields and NPC layout, in the browser.
 *
 * A field the system keeps for the GM (XP, awarded items) shows on the owner's sheet but is
 * read-only unless the GM is looking. NPCs are drawn in the system's own NPC layout when it
 * has one, and GENERATE_SHEET offers its tiers.
 */

const ID = 'sys_0123456789abcdef';

const VAULT: CustomRender = {
  id: ID,
  name: 'Vault Knights',
  words: {},
  parts: {},
  derived: ['might_mod'],
  sheet: {
    tabs: ['KNIGHT'],
    header: { nameField: 'name' },
    sections: [
      { id: 'who', label: 'WHO', layout: 'list', tab: 'KNIGHT', fields: [
        { id: 'name', label: 'Name', type: 'text' },
        { id: 'boon', label: 'Boon', type: 'text', edit: 'gm' },
        { id: 'renown', label: 'Renown', type: 'number', edit: 'gm' },
        { id: 'order', label: 'Order', type: 'select', edit: 'player', options: [{ value: 'dawn', label: 'Dawn' }] },
      ] },
    ],
  },
  npc: {
    sheet: {
      header: { nameField: 'name' },
      sections: [
        { id: 'block', label: 'STAT BLOCK', layout: 'grid', fields: [
          { id: 'might', label: 'MIGHT', type: 'number' },
          { id: 'might_mod', label: 'MOD', type: 'number' },
        ] },
      ],
    },
    tiers: [{ id: 'squire', label: 'SQUIRE' }, { id: 'champion', label: 'CHAMPION' }],
  },
};

beforeEach(() => clearCustomTemplates());
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const fieldsOf = (t: ReturnType<typeof templateFromRender>) =>
  Object.fromEntries(t.sections.flatMap((s) => s.fields).map((f) => [f.id, f]));

describe('the render copy as a template', () => {
  it('marks the GM\'s fields, and nothing else', () => {
    const fields = fieldsOf(templateFromRender(VAULT));
    expect(fields.boon.gmOnly).toBe(true);
    expect(fields.renown.gmOnly).toBe(true);
    expect(fields.name.gmOnly).toBeUndefined();
    expect(fields.order.gmOnly).toBeUndefined();
  });

  it('carries the NPC layout, with its derived values read-only, and the tiers on both', () => {
    const t = templateFromRender(VAULT);
    expect(t.npcTiers).toEqual(VAULT.npc!.tiers);
    const npc = npcTemplateOf(t);
    expect(npc).not.toBe(t);
    expect(npc.sections.map((s) => s.label)).toEqual(['STAT BLOCK']);
    expect(fieldsOf(npc).might_mod.derived).toBe(true);
    expect(npc.npcTiers).toEqual(VAULT.npc!.tiers);
  });

  it('draws NPCs with the character sheet, and offers no tiers, when the system gives neither', () => {
    const t = templateFromRender({ ...VAULT, npc: { sheet: null, tiers: [] } });
    expect(npcTemplateOf(t)).toBe(t);
    expect(t.npcTiers).toBeUndefined();
    expect(templateFromRender({ ...VAULT, npc: undefined }).npcLayout).toBeUndefined();
  });

  it('leaves the built-in systems drawing their NPCs as before', () => {
    for (const id of ['cities_without_number', 'cyberpunk_red', 'shadowrun_6e', 'generic']) {
      expect(npcTemplateOf(getTemplate(id)), id).toBe(getTemplate(id));
    }
  });
});

describe('a GM-only field on the sheet', () => {
  const show = (gm: boolean) => render(
    <SheetRenderer template={templateFromRender(VAULT)} data={{ name: 'Sir Ash', boon: 'Blessed blade', renown: 3 } as never}
      onFieldChange={vi.fn()} gm={gm} />,
  );

  it("is read-only to the character's owner, who can still edit everything else", () => {
    show(false);
    expect((screen.getByDisplayValue('Blessed blade') as HTMLInputElement).readOnly).toBe(true);
    expect((screen.getByDisplayValue('3') as HTMLInputElement).readOnly).toBe(true);
    expect((screen.getByDisplayValue('Sir Ash') as HTMLInputElement).readOnly).toBe(false);
  });

  it('is the GM\'s to edit', () => {
    show(true);
    expect((screen.getByDisplayValue('Blessed blade') as HTMLInputElement).readOnly).toBe(false);
    expect((screen.getByDisplayValue('3') as HTMLInputElement).readOnly).toBe(false);
  });

  it('stays read-only on a read-only sheet, even for the GM', () => {
    render(<SheetRenderer template={templateFromRender(VAULT)} data={{ boon: 'Blessed blade' } as never}
      onFieldChange={vi.fn()} gm readOnly />);
    expect((screen.getByDisplayValue('Blessed blade') as HTMLInputElement).readOnly).toBe(true);
  });
});

describe("the GM's sheet window", () => {
  const open = (props: { playerUsername?: string }) => {
    registerCustomTemplate(VAULT);
    vi.stubGlobal('fetch', vi.fn((url: string) => Promise.resolve({
      ok: true,
      json: () => Promise.resolve(url.startsWith('/api/settings')
        ? []
        : { id: 7, username: 'gm', system: ID, data: { name: 'Bandit', might: 12, boon: 'Crown' }, is_npc: props.playerUsername ? 0 : 1 }),
    } as Response)));
    render(<NpcSheetWindow token="t" npcId={7} npcLabel="Bandit" pos={{ x: 0, y: 0 }} setPos={vi.fn()} onClose={vi.fn()} {...props} />);
  };

  it("draws an NPC in the system's NPC layout", async () => {
    open({});
    expect(await screen.findByText(/─── STAT BLOCK ───/)).toBeTruthy();
    expect(screen.queryByText(/─── WHO ───/)).toBeNull();
  });

  it("draws a player's sheet in the character layout, with the GM's fields editable", async () => {
    open({ playerUsername: 'GHOST' });
    expect(await screen.findByText(/─── WHO ───/)).toBeTruthy();
    expect(screen.queryByText(/─── STAT BLOCK ───/)).toBeNull();
    expect((screen.getByDisplayValue('Crown') as HTMLInputElement).readOnly).toBe(false);
  });
});
