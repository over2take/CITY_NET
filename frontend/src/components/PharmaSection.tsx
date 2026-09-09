import React from 'react';
import type { SheetData, SheetFieldValue } from '../sheets/types';
import {
  PHARMA_FIELD, activeDrugs, writeActive, pharmaEffects, endScene, endDoses, strainOwed,
} from '../sheets/cwnPharma';

// What is currently in the bloodstream (CWN p60-61).
//
// Only that. Taking a dose happens on the INVENTORY row the dose is in, because a dose is
// an item and that is where items live - so there is no picker here and no catalogue, and
// nothing at all is drawn while a character is on nothing.
//
// What is left is the part an inventory row cannot hold: several drugs combining under the
// book's "only the highest bonus applies", and one button that ends them together and
// bills the System Strain they cost.

interface Props {
  data: SheetData;
  readOnly: boolean;
  onFieldChange: (fieldId: string, value: SheetFieldValue) => void;
  /**
   * Apply a change to what is running, naming it so it can be undone.
   *
   * Routed through the renderer rather than written here, because the snapshot an UNDO
   * restores has to outlive this component: ending your only drug unmounts it, and that is
   * exactly the moment somebody wants the change back.
   */
  onPharmaChange?: (fields: Record<string, string | number>, label: string) => void;
}

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

export function PharmaSection({ data, readOnly, onFieldChange, onPharmaChange }: Props) {
  const active = activeDrugs(data);
  const effects = pharmaEffects(data);
  const scene = endScene(data);

  /**
   * Ending doses, whether one by hand or the whole scene at once.
   *
   * Both go through `endDoses`, so the × cannot quietly end a drug for free while END
   * SCENE charges for the same thing. That was a real bug: the book bills the Strain when
   * the drug ends, and taking the chip off is the drug ending.
   */
  const end = (ids: string[], label: string) => {
    if (!onPharmaChange) {
      // No batching available: end them anyway rather than refusing, and leave the Strain
      // for the player. Losing the drug silently would be worse than an uncharged one.
      return onFieldChange(
        PHARMA_FIELD,
        writeActive(active.filter((d) => !ids.includes(d.id))),
      );
    }
    onPharmaChange(endDoses(data, ids), label);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
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
                title={strainOwed(data, [drug.id]) > 0
                  ? `End ${drug.label} — +${strainOwed(data, [drug.id])} System Strain`
                  : `End ${drug.label}`}
                onClick={() => end([drug.id], `END ${drug.label}`)}
                style={{
                  background: 'none', border: 'none', color: 'var(--danger)',
                  cursor: 'pointer', padding: 0, fontSize: '0.75rem', lineHeight: 1,
                }}
              >×</button>
            )}
          </span>
        ))}
      </div>

      {describeEffects(effects) && (
        <div style={{ fontSize: '0.6rem', opacity: 0.7 }}>{describeEffects(effects)}</div>
      )}

      {/* Only when there is something for it to end, and it always says the price. */}
      {!readOnly && scene.ended.length > 0 && (
        <div>
          <button
            type="button"
            className="utility-btn"
            style={{ fontSize: '0.6rem', padding: '2px 10px', whiteSpace: 'nowrap' }}
            onClick={() => end(scene.ended, 'END SCENE')}
            title="Ends the scene-length doses. Anything measured in hours keeps running."
          >
            END SCENE{scene.strain > 0 ? ` (+${scene.strain} STRAIN)` : ''}
          </button>
        </div>
      )}
    </div>
  );
}
