import type { AttackAsOption } from './tokenActions';

/**
 * ATTACK AS (4b5b4b; 8b6a, mockup waiting-hits, section 1): YOU first, then the NPCs this viewer may attack with in the
 * target's scene (tokenActions.ts attackAsOptions). With a fight running there and some NPCs outside it, two groups: IN THE
 * FIGHT, then ALSO ON THIS MAP; otherwise one list. Shown only when there is a choice.
 */
export function AttackAsPicker({ options, value, onChange }: {
  options: AttackAsOption[];
  /** The NPC's token, or null for YOU. */
  value: number | null;
  onChange: (id: number | null) => void;
}) {
  if (options.length === 0) return null;
  const fighting = options.filter((o) => o.inFight);
  const others = options.filter((o) => !o.inFight);
  const option = (o: AttackAsOption) => <option key={o.id} value={String(o.id)}>{o.name.toUpperCase()}</option>;
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.7rem', color: 'var(--green)', marginBottom: '5px' }}>
      ATTACK AS
      <select
        aria-label="Attack as"
        value={value === null ? '' : String(value)}
        onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
        style={{ flex: 1, minWidth: 0, background: 'color-mix(in srgb, var(--black) 70%, transparent)', color: 'var(--green)', border: '1px solid var(--green)', fontFamily: 'inherit', fontSize: '0.75rem', padding: '3px' }}
      >
        <option value="">YOU</option>
        {fighting.length > 0 && others.length > 0
          ? (
            <>
              <optgroup label="IN THE FIGHT">{fighting.map(option)}</optgroup>
              <optgroup label="ALSO ON THIS MAP">{others.map(option)}</optgroup>
            </>
          )
          : options.map(option)}
      </select>
    </label>
  );
}
