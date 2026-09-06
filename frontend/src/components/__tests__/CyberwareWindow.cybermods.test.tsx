/**
 * Fitting a cyberware mod (CWN p71).
 *
 * The table, the rules and the strain maths all landed before this did, which meant every
 * one of the ten was reachable only by hand-editing a sheet. This is the picker, and these
 * are the paths a player actually takes to reach it.
 *
 * The fitting rules themselves are the server's and are tested against it in
 * sheets/__tests__/cwnCyberMods.test.ts; what is tested here is the UI honouring them.
 */

import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CyberwareWindow } from '../CyberwareWindow';
import { getTemplate } from '../../sheets';

const CWN = getTemplate('cities_without_number');
const CPR = getTemplate('cyberpunk_red');

const row = (over = {}) => ({
  name: 'Enhanced Reflexes', type: 'nerve', side: null, hl: 3, cost: 5000,
  conc: 'touch', data: '', equipped: true, placed: true, mods: [], cyberMods: [], ...over,
});

/** A blade, which is what Monoblade and Targeting Processor need. */
const blade = (over = {}) => row({ name: 'Body Blades II', type: 'limb', hl: 2, ...over });

/** Skin cyber granting a base AC, which is what Hardened Weave needs. */
const derm = (over = {}) => row({
  name: 'Dermal Armor I', type: 'skin', hl: 2, conc: 'medical',
  mods: [{ kind: 'note', target: 'Base AC', value: 16 }], ...over,
});

const show = (rows: unknown[], { template = CWN, con = 20 } = {}) => {
  const onFieldChange = vi.fn();
  render(
    <CyberwareWindow
      data={{ cyberware: rows, con }}
      template={template}
      onFieldChange={onFieldChange}
      onClose={vi.fn()}
      who="nyx"
    />,
  );
  return onFieldChange;
};

/** Open the edit form for a named piece. */
const edit = (name: string) =>
  userEvent.click(screen.getByRole('button', { name: `Edit ${name}` }));

const picker = () => screen.getByRole('combobox', { name: 'Fit a cyberware mod' });

/** What the picker offers, as [label, disabled] pairs. */
const offered = () =>
  [...(picker() as HTMLSelectElement).options].slice(1)
    .map((o) => [o.textContent ?? '', o.disabled] as const);

/** The array the window wrote back to the sheet. */
const written = (onFieldChange: ReturnType<typeof vi.fn>) =>
  onFieldChange.mock.calls.at(-1)?.[1] as Record<string, unknown>[];

describe('the picker is a Cities Without Number thing', () => {
  it('is offered on CWN', async () => {
    show([row()]);
    await edit('Enhanced Reflexes');
    expect(picker()).toBeInTheDocument();
  });

  it('is not offered on Cyberpunk RED, whose book has no such table', async () => {
    // CP:R spends Humanity and has its own upgrade rules. Putting p71 in its sheet would be
    // one game's vocabulary in another's.
    show([row()], { template: CPR });
    await edit('Enhanced Reflexes');
    expect(screen.queryByRole('combobox', { name: 'Fit a cyberware mod' })).toBeNull();
  });
});

describe('what it offers', () => {
  it('lists all ten the book prints', async () => {
    show([row()]);
    await edit('Enhanced Reflexes');
    expect(offered()).toHaveLength(10);
  });

  it('prints what each one does, not just its name', async () => {
    show([row()]);
    await edit('Enhanced Reflexes');
    expect(offered().find(([l]) => l.startsWith('MONOBLADE'))?.[0])
      .toContain('+1 to weapon Trauma Die');
  });

  it('greys out a mod that will not take, and says why', async () => {
    // A Monoblade needs something to sharpen. Listed rather than hidden: missing from the
    // list reads as the app not having it, where a greyed one teaches the rule.
    show([row()]);
    await edit('Enhanced Reflexes');
    const [label, disabled] = offered().find(([l]) => l.startsWith('MONOBLADE'))!;
    expect(disabled).toBe(true);
    expect(label).toContain('needs a bladed cyber system');
  });

  it('enables that same mod on a system it does fit', async () => {
    show([blade()]);
    await edit('Body Blades II');
    expect(offered().find(([l]) => l.startsWith('MONOBLADE'))?.[1]).toBe(false);
  });

  it('gates Hardened Weave on the implant granting an AC', async () => {
    show([derm(), row()]);
    await edit('Dermal Armor I');
    expect(offered().find(([l]) => l.startsWith('HARDENED WEAVE'))?.[1]).toBe(false);
  });

  it('gates Tailored Interface on the system costing 2+ Strain', async () => {
    show([row({ name: 'Cheap Chrome', hl: 1 })]);
    await edit('Cheap Chrome');
    const [label, disabled] = offered().find(([l]) => l.startsWith('TAILORED INTERFACE'))!;
    expect(disabled).toBe(true);
    expect(label).toContain('needs a system costing 2 or more Strain');
  });

  it('stops offering one that is already fitted', async () => {
    // Offering it twice would suggest two of them stack, which p71 denies for the one mod
    // where stacking would matter.
    show([blade({ cyberMods: ['monoblade'] })]);
    await edit('Body Blades II');
    expect(offered().some(([l]) => l.startsWith('MONOBLADE'))).toBe(false);
    expect(offered()).toHaveLength(9);
  });
});

describe('fitting one', () => {
  it('writes it into the row', async () => {
    const wrote = show([blade()]);
    await edit('Body Blades II');
    await userEvent.selectOptions(picker(), 'monoblade');
    await userEvent.click(screen.getByRole('button', { name: 'SAVE' }));

    expect(written(wrote)[0].cyberMods).toEqual(['monoblade']);
  });

  it('keeps more than one', async () => {
    const wrote = show([blade()]);
    await edit('Body Blades II');
    await userEvent.selectOptions(picker(), 'monoblade');
    await userEvent.selectOptions(picker(), 'quick_detach');
    await userEvent.click(screen.getByRole('button', { name: 'SAVE' }));

    expect(written(wrote)[0].cyberMods).toEqual(['monoblade', 'quick_detach']);
  });

  it('takes one off again', async () => {
    const wrote = show([blade({ cyberMods: ['monoblade', 'quick_detach'] })]);
    await edit('Body Blades II');
    await userEvent.click(screen.getByRole('button', { name: 'Remove MONOBLADE' }));
    await userEvent.click(screen.getByRole('button', { name: 'SAVE' }));

    expect(written(wrote)[0].cyberMods).toEqual(['quick_detach']);
  });

  it('leaves the rest of the row alone', async () => {
    // The regression that would matter most: fitting a mod must not rewrite the piece.
    const wrote = show([blade({ cost: 9000, data: 'Retractable' })]);
    await edit('Body Blades II');
    await userEvent.selectOptions(picker(), 'monoblade');
    await userEvent.click(screen.getByRole('button', { name: 'SAVE' }));

    expect(written(wrote)[0]).toMatchObject({
      name: 'Body Blades II', hl: 2, cost: 9000, data: 'Retractable', type: 'limb',
    });
  });
});

describe('what the list shows', () => {
  it('puts a chip on the row', async () => {
    show([blade({ cyberMods: ['monoblade'] })]);
    expect(screen.getByTitle(/\+1 to weapon Trauma Die/)).toHaveTextContent('MONOBLADE');
  });

  it('marks a fitted mod that has stopped fitting, rather than hiding it', async () => {
    // Fitting is checked against the row as it is now, so renaming the blade leaves a mod
    // that has quietly stopped working. Hiding it would hide the reason too.
    show([blade({ name: 'Just An Arm', cyberMods: ['monoblade'] })]);
    const chip = screen.getByTitle(/inert here: needs a bladed cyber system/);
    expect(chip).toHaveTextContent('MONOBLADE');
    expect(chip).toHaveStyle({ textDecoration: 'line-through' });
  });
});

describe('the strain a fitted mod changes', () => {
  it('shows the discounted cost beside what was typed', async () => {
    // The ceiling above the table already counted the discount, so a row printing the raw
    // number disagreed with the total two lines away. Every place the row is listed - the
    // body panel and the table both - or the disagreement just moves.
    show([row({ hl: 3, cyberMods: ['tailored_interface'] })]);
    const shown = screen.getAllByTitle(/3 for the system, less 1 from its fitted mods/);
    expect(shown.length).toBeGreaterThan(1);
    for (const el of shown) expect(el).toHaveTextContent('2 (3)');
  });

  it('says nothing extra when no mod changed it', async () => {
    show([row({ hl: 3 })]);
    expect(screen.queryByTitle(/from its fitted mods/)).toBeNull();
  });

  it('counts the discount against the strain ceiling', async () => {
    // CON 3 leaves room for exactly 3. A 3-strain system with a Tailored Interface costs 2,
    // so this character can carry it and one point of something else.
    show([row({ hl: 3, cyberMods: ['tailored_interface'] })], { con: 3 });
    expect(screen.getByText(/STRAIN 2 \/ 3/)).toBeInTheDocument();
  });

  /**
   * Installing, which is the only path the ceiling guards.
   *
   * Adding to the list costs nothing - owning chrome is not carrying it - so the check
   * fires when a piece goes into a body part, which is the `+` on a panel.
   */
  const installIntoNerve = async (hl: string, mod?: string) => {
    await userEvent.click(screen.getByRole('button', { name: 'Add to Nerve' }));
    await userEvent.type(screen.getByLabelText('Cyberware name'), 'Enhanced Reflexes');
    await userEvent.type(screen.getByLabelText('Humanity loss'), hl);
    if (mod) await userEvent.selectOptions(picker(), mod);
    await userEvent.click(screen.getByRole('button', { name: 'ADD' }));
  };

  it('lets a piece be installed that its raw cost would have refused', async () => {
    // The end of the chain, and the reason the discount has to reach `admits`: the sheet
    // said there was room, so the install must not then refuse it.
    const wrote = show([row({ name: 'Old Chrome', hl: 2 })], { con: 4 });
    await installIntoNerve('3', 'tailored_interface');

    // 2 already installed + 2 after the discount = 4, exactly the ceiling.
    expect(screen.queryByText(/NOT ENOUGH SYSTEM STRAIN/)).toBeNull();
    expect(written(wrote)).toHaveLength(2);
    expect(written(wrote)[1]).toMatchObject({ name: 'Enhanced Reflexes', hl: 3, cyberMods: ['tailored_interface'] });
  });

  it('refuses that same piece without the mod', async () => {
    // The other half of the pair: 2 + 3 is over a ceiling of 4, so the discount above is
    // doing the work rather than the check having quietly stopped running.
    const wrote = show([row({ name: 'Old Chrome', hl: 2 })], { con: 4 });
    await installIntoNerve('3');

    expect(screen.getByText(/NEEDS 3, 2 FREE OF 4/)).toBeInTheDocument();
    expect(wrote).not.toHaveBeenCalled();
  });

  it('still refuses a piece that does not fit even with the discount', async () => {
    const wrote = show([row({ name: 'Old Chrome', hl: 3 })], { con: 4 });
    await installIntoNerve('3', 'tailored_interface');

    // 3 installed + 2 discounted = 5, over a ceiling of 4. The message quotes what it will
    // actually cost, not the 3 on the form.
    expect(screen.getByText(/NEEDS 2, 1 FREE OF 4/)).toBeInTheDocument();
    expect(wrote).not.toHaveBeenCalled();
  });
});

describe('the draft form as it is being filled', () => {
  it('offers Tailored Interface only once a strain cost is typed', async () => {
    // An empty box counts as 0, and offering a mod that would be taken away again the
    // moment the form is read back is worse than not offering it yet.
    show([], { con: 20 });
    await userEvent.click(screen.getByText('+ ADD CYBERWARE'));
    expect(offered().find(([l]) => l.startsWith('TAILORED INTERFACE'))?.[1]).toBe(true);

    await userEvent.type(screen.getByLabelText('Humanity loss'), '2');
    expect(offered().find(([l]) => l.startsWith('TAILORED INTERFACE'))?.[1]).toBe(false);
  });

  it('offers the blade mods once the name says it is a blade', async () => {
    show([], { con: 20 });
    await userEvent.click(screen.getByText('+ ADD CYBERWARE'));
    expect(offered().find(([l]) => l.startsWith('TARGETING PROCESSOR'))?.[1]).toBe(true);

    await userEvent.type(screen.getByLabelText('Cyberware name'), 'Body Blades I');
    expect(offered().find(([l]) => l.startsWith('TARGETING PROCESSOR'))?.[1]).toBe(false);
  });
});

/**
 * Concealment, which is what makes Profile Adjustment real.
 *
 * The rating was stored on every row and rendered nowhere, so two of the ten mods were
 * invisible: Profile Adjustment did nothing anyone could see, and Hardened Weave's price -
 * it makes the system Obvious - was charged silently.
 */
describe('how hard the chrome is to spot', () => {
  it('shows the rating the piece carries', () => {
    show([row({ conc: 'touch' })]);
    expect(screen.getAllByText('Touch').length).toBeGreaterThan(0);
  });

  it('shows a dash where nobody rated it', () => {
    show([row({ conc: '' })]);
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
  });

  it('steps it down for Profile Adjustment, and says what it was', () => {
    show([row({ conc: 'sight', cyberMods: ['profile_adjustment'] })]);
    const cell = screen.getByTitle('Sight on its own, Touch with its mods fitted');
    expect(cell).toHaveTextContent('Touch (Sight)');
  });

  it('makes Hardened Weave visibly cost you Obvious', () => {
    // The whole point: the player takes +2 AC and should be able to see what it cost.
    show([derm({ conc: 'medical', cyberMods: ['hardened_weave'] })]);
    expect(screen.getByTitle('Medical on its own, Obvious with its mods fitted'))
      .toHaveTextContent('Obvious (Medical)');
  });

  it('says nothing extra when no mod moved it', () => {
    show([row({ conc: 'touch', cyberMods: ['quick_detach'] })]);
    expect(screen.queryByTitle(/with its mods fitted/)).toBeNull();
  });

  it('lets a hand-added piece be given a rating', async () => {
    const wrote = show([]);
    await userEvent.click(screen.getByText('+ ADD CYBERWARE'));
    await userEvent.type(screen.getByLabelText('Cyberware name'), 'Backstreet Chrome');
    await userEvent.selectOptions(screen.getByLabelText('Concealment'), 'medical');
    await userEvent.click(screen.getByRole('button', { name: 'ADD' }));

    expect(written(wrote)[0]).toMatchObject({ name: 'Backstreet Chrome', conc: 'medical' });
  });

  it('sorts by how visible it is, not alphabetically', async () => {
    // Alphabetical puts Medical between Obvious and Sight, which means nothing.
    show([
      row({ name: 'A', conc: 'medical' }),
      row({ name: 'B', conc: 'obvious' }),
      row({ name: 'C', conc: 'touch' }),
    ]);
    await userEvent.click(screen.getByRole('columnheader', { name: /CONC/ }));
    const names = screen.getAllByRole('row').slice(1)
      .map((r) => r.querySelectorAll('td')[1]?.textContent);
    expect(names).toEqual(['B', 'C', 'A']); // Obvious, Touch, Medical
  });
});
