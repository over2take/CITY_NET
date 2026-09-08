import React from 'react';
import type { SheetSection, SheetData, SheetFieldValue } from '../sheets/types';
import {
  PHARMA_FIELD, CWN_PHARMACEUTICALS, activeDrugs, writeActive, pharmaEffects, endScene,
  describePharma, carriedDoses, consumeDose, type Pharmaceutical,
} from '../sheets/cwnPharma';
import { INVENTORY_FIELD, writeInventory } from '../sheets/inventory';

// What a character is currently on (CWN p60-61).
//
// Its own component rather than a `tag_list` because of one control: ending the scene is
// two writes, not one - the scene-length doses come off and their System Strain goes on -
// and a chip list has nowhere to put a button that says what it is about to cost.
//
// In the header would be wrong too, unlike SEATING next door: that has to stay reachable
// while the section is collapsed, whereas ending a scene is something you do while looking
// at what is running.

const heading: React.CSSProperties = {
  fontSize: '0.55rem', opacity: 0.65, letterSpacing: '1px',
};

const input: React.CSSProperties = {
  background: 'color-mix(in srgb, var(--black) 50%, transparent)',
  border: '1px solid var(--green)',
  color: 'var(--green)',
  fontFamily: 'inherit',
  fontSize: '0.7rem',
  padding: '1px 4px',
  width: '100%',
  boxSizing: 'border-box',
};

interface Props {
  section: SheetSection;
  data: SheetData;
  readOnly: boolean;
  onFieldChange: (fieldId: string, value: SheetFieldValue) => void;
  /** Narrower than the field type on purpose: everything written here is the active list
   *  as a JSON string, or a hit-point / Strain number. */
  onFieldsChange?: (fields: Record<string, string | number>) => void;
}

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/** What the active drugs are doing, in the order the book lists them. */
const describeEffects = (e: ReturnType<typeof pharmaEffects>): string => {
  const bits: string[] = [];
  if (e.hit) bits.push(`+${e.hit} to hit`);
  if (e.damage) bits.push(`+${e.damage} damage`);
  if (e.shock) bits.push(`+${e.shock} Shock`);
  if (e.incomingTrauma) bits.push(`+${e.incomingTrauma} to Trauma Dice against you`);
  if (e.majorInjury) bits.push(`${e.majorInjury} on Major Injury`);
  return bits.join(' · ');
};

export function PharmaSection({ section, data, readOnly, onFieldChange, onFieldsChange }: Props) {
  const active = activeDrugs(data);
  const effects = pharmaEffects(data);
  const scene = endScene(data);
  const taken = new Set(active.map((d) => d.id));
  const available = CWN_PHARMACEUTICALS.filter((d) => !taken.has(d.id));
  // Doses live in the inventory, counted like ammunition, because that is what they are.
  const doses = carriedDoses(data);
  const carrying = available.filter((d) => (doses.get(d.id) ?? 0) > 0);
  const notCarrying = available.filter((d) => !(doses.get(d.id) ?? 0));

  const write = (drugs: (Pharmaceutical | string)[]) =>
    onFieldChange(PHARMA_FIELD, writeActive(drugs as string[]));

  const dose = (id: string) => {
    const drug = CWN_PHARMACEUTICALS.find((d) => d.id === id);
    if (!drug) return;

    const fields: Record<string, string | number> = {
      [PHARMA_FIELD]: writeActive([...active, drug]),
    };
    // A dose comes out of the kit if one is there. Not required to be: a GM handing
    // somebody a stim mid-scene is the ordinary case, and refusing it would make the
    // sheet argue with the table.
    const spent = consumeDose(data, drug.id);
    if (spent) fields[INVENTORY_FIELD] = writeInventory(spent);
    // Hit points are the one thing a drug hands over rather than lends. Avalanche's +10
    // is spent as play goes on, so it has to be a real write - an overlay recomputed on
    // read would hand it back every time somebody opened the sheet.
    if (drug.grantsHp) fields.hp = num(data.hp) + drug.grantsHp;

    // One write when there is more than one field, so a dose cannot half-apply.
    if (Object.keys(fields).length > 1 && onFieldsChange) return onFieldsChange(fields);
    write([...active, drug]);
  };

  const finishScene = () => {
    if (!onFieldsChange) return write(scene.remaining);
    const max = num(data.system_strain_max);
    // Clamped at the maximum because the sheet has nowhere to say "over": the number is a
    // pool with a ceiling, and a character at the ceiling is already in the state the
    // rules care about.
    const strain = max > 0
      ? Math.min(max, num(data.system_strain) + scene.strain)
      : num(data.system_strain) + scene.strain;
    onFieldsChange({
      [PHARMA_FIELD]: writeActive(scene.remaining),
      system_strain: strain,
    });
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
      {active.length === 0 && (
        <div style={{ fontSize: '0.65rem', opacity: 0.5 }}>
          Nothing running. Combat chems, sedatives and street drugs live here - only the
          ones the app can roll with change a number.
        </div>
      )}

      {active.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
          {active.map((drug) => (
            <span
              key={drug.id}
              title={drug.effect}
              style={{
                border: '1px solid var(--green)', fontSize: '0.6rem', letterSpacing: '1px',
                padding: '1px 4px 1px 6px', display: 'inline-flex', alignItems: 'center', gap: '5px',
                background: 'color-mix(in srgb, var(--green) 12%, transparent)',
              }}
            >
              {drug.label}
              {!readOnly && (
                <button
                  type="button"
                  aria-label={`Remove ${drug.label}`}
                  onClick={() => write(active.filter((d) => d.id !== drug.id))}
                  style={{
                    background: 'none', border: 'none', color: 'var(--danger)',
                    cursor: 'pointer', padding: 0, fontSize: '0.75rem', lineHeight: 1,
                  }}
                >×</button>
              )}
            </span>
          ))}
        </div>
      )}

      {active.length > 0 && describeEffects(effects) && (
        <div style={{ fontSize: '0.6rem', opacity: 0.7 }}>{describeEffects(effects)}</div>
      )}

      {!readOnly && (
        <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
          {/* What you are carrying comes first and says how many are left, because that is
              the list somebody is actually choosing from. The rest stays reachable: a GM
              handing over a dose mid-scene should not have to add an inventory row first. */}
          <select
            aria-label="Take a dose"
            value=""
            onChange={(e) => { if (e.target.value) dose(e.target.value); }}
            style={{ ...input, maxWidth: '260px' }}
          >
            <option value="">+ DOSE…</option>
            {carrying.length > 0 && (
              <optgroup label="CARRYING">
                {carrying.map((drug) => (
                  <option key={drug.id} value={drug.id}>
                    {drug.label} ×{doses.get(drug.id)} — {describePharma(drug)}
                  </option>
                ))}
              </optgroup>
            )}
            <optgroup label={carrying.length > 0 ? 'NOT CARRYING' : 'THE BOOK’S TABLE'}>
              {notCarrying.map((drug) => (
                <option key={drug.id} value={drug.id}>
                  {drug.label} — {describePharma(drug)}
                </option>
              ))}
            </optgroup>
          </select>

          {/* Only when there is something for it to end, and it always says the price. */}
          {scene.ended.length > 0 && (
            <button
              type="button"
              className="utility-btn"
              style={{ fontSize: '0.6rem', padding: '2px 10px', whiteSpace: 'nowrap' }}
              onClick={finishScene}
              title={`Ends ${scene.ended.length} scene-length dose(s). Anything measured in hours keeps running.`}
            >
              END SCENE{scene.strain > 0 ? ` (+${scene.strain} STRAIN)` : ''}
            </button>
          )}
        </div>
      )}

      {section.id && active.some((d) => d.hostile) && (
        <div style={heading}>
          A hostile drug is listed. Those are administered to someone else - the app rolls
          none of their saving throws.
        </div>
      )}
    </div>
  );
}
