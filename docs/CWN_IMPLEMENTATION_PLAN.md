# Cities Without Number — Implementation Plan

Branch: `Cities-Without-Number`
Reference: CWN Quick Reference Documents v2.2 (CC BY-NC 4.0, by 0frames)

**Licensing**: unlike CP:R (labels + dice math only, no book text), the CWN QRD is
CC BY-NC 4.0 — tables and rules text from the QRD MAY be embedded with attribution.
Keep the attribution line in every file that includes QRD-derived content.

---

## Model Work Assignment

Work is split between **Fable** (novel engine logic, architecture decisions) and
**Sonnet 4.6** (pattern-following work with a CP:R blueprint to copy). Switch
models with `/model` at the checkpoints below. Each block assumes the previous
block is committed.

| Order | Model      | Phases | Work |
|-------|-----------|--------|------|
| 1 ✅  | **Fable**  | 2 (decision) | Decide the derived-field approach (extend `applyDerived` vs inline mods) — settles field ids like `str_mod` before anything else is written. Touches the CP:R Humanity→EMP path, so regression-sensitive. |
| 2 ✅  | **Fable**  | 1 + 2  | Sheet template + server metadata (`templates.js`, roll map). Everything downstream references these field ids — must land first and correctly. |
| 3 ✅  | → switch to **Sonnet 4.6** | 6, 7 (UI), 8 | NPC tiers + spirit tiers (copy `npcTiers.js` shape), admin toggles (copy take-10 checkbox), import aliases (copy importer shape). Pure pattern work; the CP:R files are line-by-line blueprints. |
| 4 ✅  | → switch to **Fable** | 3, 4, 5 | `attackCwn.js` (trauma/shock — nothing to copy), death/stabilization state (`rounds_since_downed`, Frail), System Strain, and all System Isolation requirements. |
| 5 ✅  | **Fable**  | 9      | Tests, especially the system-switch round-trip test and trauma on/off coverage. Fable wrote the engine, so it writes the tests. |

**Switch rules:**
- Do NOT switch mid-phase. Commit and push the current block before switching.
- Sonnet's block (row 3) can run in parallel with Fable's row 4 in a second
  session IF they stay off each other's files — otherwise run sequentially.
- If Sonnet hits anything requiring a design decision (new field id, engine
  behavior, isolation question), stop and hand back to Fable rather than
  improvising.
- Either model updates this table's row status as blocks complete.

---

## System Overview

**Core mechanic**: `2d6 + skill + attribute mod >= target difficulty`
**Attack roll**: `1d20 + base hit bonus + combat skill + weapon mod >= enemy AC`
**Saving throws**: `1d20 >= 16 - (level + relevant mod)` — a 1 always fails, 20 always saves

---

## Phase 1 — Sheet Template

File: `frontend/src/sheets/templates/cities_without_number.ts`

### Stats (6 attributes + modifiers)
- STR, DEX, CON, INT, WIS, CHA
- Modifiers derived from the SWN/CWN table (NOT D&D's floor((stat-10)/2)):
  3 → -2, 4–7 → -1, 8–13 → 0, 14–17 → +1, 18+ → +2

### Core Fields
- `level`, `base_hit_bonus`
- `hp`, `hp_max`
- `system_strain`, `system_strain_max` (= CON score, not modifier)
- `ac` (armor class)

### Saving Throws (derived, shown read-only)
- `save_physical` = 16 - (level + max(STR mod, CON mod))
- `save_evasion` = 16 - (level + max(DEX mod, INT mod))
- `save_mental` = 16 - (level + max(WIS mod, CHA mod))
- `save_luck` = 16 - level

### Skills (all 20)
administer, connect, drive, exert, fix, heal, know, lead, notice, perform,
program, punch, shoot, sneak, stab, survive, talk, trade, work
- Each field: numeric level (-1 = untrained, 0 = basic, 1-4 = skilled)
- Each rolls: `2d6 + skill + best relevant attribute mod >= DC`

### Conditions / Status
- `frail` (boolean flag) — shown as banner; instant death at 0 HP while frail
- `frail` cleared after 1 week bedrest + medical care, or Heal skill check DC 10

### Template Config (mirrors cyberpunk_red.ts)
- `tokenDefense: { editOnToken: true, label: 'AC' }` — CWN AC is a single number, safe to edit on the token (unlike CP:R's per-location SP)
- `npcTiers` list must match `backend/sheets/npcTiers.js` ids exactly
- Header: nameField `name`, hpField/hpMaxField linked to token, strain as a chip
- `auto_initiative` (checkbox) — from Foci/cyberware; unused today, read by the future initiative tracker (see INITIATIVE_SYSTEMS.md) so no sheet migration is needed later

### Weapon Rows (4 rows)
Per row: `name`, `damage`, `trauma_die`, `trauma_rating`, `shock_dmg`, `shock_ac`, `range`, `skill`, `attribute`

⚠ CWN damage strings include flat modifiers (`1d8+2`) — the CWN weapon validator
must accept `NdM(+K)?`, unlike CP:R's `^\d+d\d+$` regex in `attack.js`.

- **trauma_die**: die type (d4/d6/d8/d10/d12) rolled on hit
- **trauma_rating**: trauma die result >= this value → traumatic hit (multiply damage by trauma rating)
- **shock_dmg**: damage dealt on miss if shock_ac >= enemy AC
- **shock_ac**: the AC threshold for shock to apply

### Identity / Notes
- handle, background, class, faction, foci (special abilities), notes, aliases, description

---

## Phase 2 — Server Template Metadata, Derived Fields & Roll Map

Files: `backend/sheets/templates.js`, `backend/sheets/rolls.js`, `frontend/src/sheets/index.ts`

### Server Metadata (`templates.js` — REQUIRED, this is the privacy gate)
```js
cities_without_number: {
  name: 'Cities Without Number',
  publicFields: ['name', 'background', 'class', 'description'],
  combatFields: ['ac'],           // never exposed to non-owners
  linkedFields: { hp: 'token_hp', hp_max: 'token_hp_max', cash: 'bank_balance' },
  maxPairs: {
    system_strain_max: 'system_strain',
    mage_effort_max: 'mage_effort',         // Deluxe
    summoner_effort_max: 'summoner_effort', // Deluxe
  },
}
```

### Derived Fields
- Attribute modifiers from the SWN/CWN table: 3 → -2, 4–7 → -1, 8–13 → 0,
  14–17 → +1, 18+ → +2 (NOT D&D's floor((stat-10)/2))
- Saving throws: computed from level + mods (read-only display)
- `system_strain_max` mirrors CON score (not mod)

✔ DECIDED: mods/saves are stored as real sheet fields (`str_mod`, `save_physical`,
...), recomputed server-side by a new per-system `recompute(data)` hook in
`templates.js`, run from `applyDerived` after any write. CP:R's divisor rule
(Humanity→EMP) is untouched. `@str_mod` then works in roll formulas unchanged.

### Roll Map
Each skill maps to `2d6 + skill + attribute mod`, executed in plain **sum** mode
(CP:R uses `explode10` — nothing explodes in CWN, do not reuse it).

⚠ RAW lets several skills use the better of two attributes (punch: STR or DEX).
The formula resolver has no `max()` — pin each skill to its primary attribute
(simplest, matches the CP:R `skill()` helper pattern):
```
punch   → 2d6 + @punch   + @str_mod
shoot   → 2d6 + @shoot   + @dex_mod
stab    → 2d6 + @stab    + @str_mod
sneak   → 2d6 + @sneak   + @dex_mod
exert   → 2d6 + @exert   + @str_mod
heal    → 2d6 + @heal    + @int_mod
program → 2d6 + @program + @int_mod
notice  → 2d6 + @notice  + @wis_mod
... (all 20 skills follow same pattern; players adjust the odd case manually)
```

---

## Phase 3 — Combat Engine

File: `backend/sheets/attackCwn.js` (NEW module — `attack.js` is a bundle of
CP:R-specific pure functions (SP soak, aimed shots, LUCK spends); the socket
handler dispatches by `active_system` to the right module rather than
branching inside CP:R code)

### To-Hit
```
1d20 + base_hit_bonus + combat_skill + weapon_mod >= target_ac
```

### Trauma (on hit only — OPTIONAL RULE, gated by `cwn_trauma` house rule)
Trauma is CWN's optional "grittier combat" rule, not core. The attack engine
checks the `cwn_trauma` setting; when OFF, no trauma die is rolled and attacks
resolve as plain hit/damage + shock.

When ON:
- Roll weapon's trauma die
- If result >= trauma_rating → traumatic hit
- Traumatic hit: multiply total damage by trauma_rating
- Trauma only applies to lethal damage

### Shock (on miss)
- If weapon shock_ac >= target AC → deal shock_dmg + attribute mod
- Shock always applies even on a miss (if AC condition met)
- Shock is not multiplied by trauma

### Damage
- Weapon damage dice + attribute mod
- If traumatic: × trauma_rating

### NPC Attacks
- NPCs attack with modifier = their hit dice (no skill separation)

---

## Phase 4 — Death & Stabilization

Socket handler: `requestStabilize` (new, CWN-specific)

### Mortal Wound Flow
- PC at 0 HP → Mortally Wounded banner (same red banner as CP:R)
- Dies after 6 rounds unless stabilized
- Server tracks `rounds_since_downed` per sheet
- Healing above 0 HP clears mortal wound state

### Stabilization Check
- Main action by ally: `Heal + Dex or Int mod` vs DC `8 + rounds_since_downed` (+2 if no tools/medkit)
- On success: PC recovers to 1 HP with **Frail** condition
- Frail: instant death at 0 HP, no auto-heal, removed after 1 week bedrest or Heal DC 10

### Major Injuries (only when `cwn_trauma` is ON)
Major injuries ride on the trauma rule — not a separate toggle; the flow
simply doesn't exist when trauma is off.
- Triggered if PC reaches 0 HP in a scene after suffering a traumatic hit
- Physical save → on fail: roll on major injury table (d12, shown in GM reference)
- GM rolls manually; table results tracked as notes (not automated)

---

## Phase 5 — System Strain

Tracked server-side on sheet field `system_strain` (max = CON score).

### Sources of Strain
- Healing without Heal skill: +1 strain
- Overcasting (Deluxe): +1 to +4 strain depending on consequence roll
- Cyberware: permanently reduces max Mage Effort (not strain directly)

### Recovery
- 1 temporary system strain removed per long rest
- Shown on sheet with current/max display

---

## Phase 6 — NPC Tiers

File: `backend/sheets/npcTiers.js` — `cities_without_number` entry

| Tier     | HD  | HP  | AC  | Attack Mod | Skills | Notes             |
|----------|-----|-----|-----|------------|--------|-------------------|
| MOOK     | 1   | 5   | 10  | +1         | 0      | Shock 1/AC 10     |
| SKILLED  | 3   | 15  | 13  | +3         | 1      | Trauma d6         |
| VETERAN  | 6   | 30  | 15  | +6         | 2      | Trauma d8, Shock 3|
| ELITE    | 10  | 50  | 18  | +10        | 3      | Trauma d10        |

- NPC attack mod = hit dice (per rules)
- NPCs heal equal to their hit dice per long rest
- Tier ids in the frontend template's `npcTiers` list must match these ids exactly
  (CP:R precedent: mook/skilled/pro/elite — CWN uses veteran in place of pro)

### Spirit Tiers (Deluxe — quick win)
Summoned spirits are just NPC tiers; add 2–3 entries so Summoners get
GENERATE_SHEET support for free:

| Tier          | HD | HP | AC | Attack Mod | Notes                 |
|---------------|----|----|----|------------|-----------------------|
| LESSER SPIRIT | 2  | 10 | 14 | +2         | Immediate summon      |
| SPIRIT        | 5  | 25 | 16 | +5         | Ritual summon         |
| GREATER SPIRIT| 8  | 40 | 18 | +8         | Ritual, high Effort   |

---

## Phase 7 — CWN House Rules (Admin Panel)

Two toggles in ADMIN > TTRPG_SYSTEM when CWN is active (CP:R precedent: the
take-10 melee DV toggle). Both keys namespaced `cwn_` — see System Isolation.

| Setting key  | Label                | Default | Gates                                    |
|--------------|----------------------|---------|------------------------------------------|
| `cwn_trauma` | GRITTY COMBAT (TRAUMA)| ON     | Trauma die on hits + Major Injury flow   |
| `cwn_deluxe` | DELUXE EDITION       | OFF     | Spellcasting + Summoning sheet sections  |

Both stored in `global_settings`. Non-toggles (core rules, always on): Shock,
Frail, 6-round mortal wound timer, PCs-win-initiative-ties.

### Deluxe Edition (`cwn_deluxe`)

### Effort Tracking — Quick Win
The existing LUCK pip system (`luckField`/`luckMaxField` + `maxPairs` clamping,
admin reset) is exactly a spendable current/max pool. Reuse that mechanism for
Mage Effort and Summoner Effort instead of building anything new — effort
tracking comes nearly free.

### When Enabled — Sheet Fields Added
**Spellcasting:**
- `cast_skill` (numeric, 0–4)
- `mage_effort`, `mage_effort_max` (= max(int_mod, wis_mod) + cast_skill, min 1)
- `spells_prepared_max` (= floor(level/2 rounded up) + cast_skill)
- `spells` (notes field listing prepared spells)

**Summoning:**
- `summon_skill` (numeric, 0–4)
- `summoner_effort`, `summoner_effort_max` (= max(con_mod, cha_mod) + summon_skill, min 1)
- `spirits` (notes field)

### Overcasting Table (GM reference, shown on sheet when relevant)
| d20  | Consequence                                               |
|------|-----------------------------------------------------------|
| 1    | Instant unavoidable death                                 |
| 2–4  | Mortally wounded, 0 HP                                    |
| 5–8  | +4 System Strain, unconscious 1 minute                    |
| 9–15 | +2 System Strain, stunned next round                      |
| 16–19| +1 System Strain, lose next Main Action                   |
| 20+  | +1 System Strain                                          |

Roll: `d20 + cast_skill + con_mod`

---

## Phase 8 — Sheet Import

File: `backend/sheets/importers.js` — `cities_without_number` entry

### Alias Mapping
- Stats: str/strength, dex/dexterity, con/constitution, int/intelligence, wis/wisdom, cha/charisma
- Skills: all 20 by name and common abbreviations
- HP: hit points, hp, max hp
- AC: armor class, ac, defense
- Level: lvl, level, char level

---

## Phase 9 — Tests

- `backend/__tests__/cwn_attack.test.js` — to-hit, trauma (on AND off via `cwn_trauma`), shock on miss, NPC attacks
- `backend/__tests__/cwn_stabilize.test.js` — mortal wound timer, stabilization DC, frail flag
- Frontend renderer tests for CWN-specific sections (saves, system strain, frail banner)

---

## System Isolation — No Bleed Between Rulesets

The admin can switch `game_system` at any time; each ruleset must be fully
self-contained. What's already safe, and what CWN must not break:

### Already isolated (verified against current code)
- **Sheets**: `character_sheets.system` column; every route and socket handler
  resolves `game_system` fresh and queries `AND system = ?`. A player's CP:R
  sheet and CWN sheet coexist; switching back restores the old sheet untouched.
- **NPC library**: filtered by active system.
- **Importers / roll maps / templates**: selected by active system at call time.

### Shared surfaces — CWN work must handle these
1. **Token defense value**: tokens are system-agnostic. A DV stamped under
   CP:R is meaningless as CWN AC (different scales). On `gameSystemChanged`
   the attack path must never read a stale value from the other system —
   either re-stamp defense from the newly-active sheet on attach/switch, or
   treat missing/stale as "GM must set AC".
2. **Transient combat state**: CP:R death-save penalty and CWN's
   `rounds_since_downed` / Frail tracking must be keyed per (sheet, system) —
   never on the token — and reset on system switch.
3. **Attack dispatch**: the socket handler must dispatch strictly on
   `active_system` → `attack.js` (CP:R) / `attackCwn.js` (CWN). No shared
   mutable state between the two modules (both stay pure functions).
4. **Settings keys are namespaced per system**: CP:R take-10 melee DV,
   `cwn_deluxe`, etc. A CWN toggle must never change CP:R behavior. Naming
   convention: prefix with system (`cwn_deluxe`, not `deluxe`).
5. **Frontend on `gameSystemChanged`**: open sheet/NPC-library windows render
   the old template — close or reload them on the event.
6. **Tests**: add a switch-back-and-forth test — create CP:R sheet, switch to
   CWN, create CWN sheet, switch back — asserting neither sheet's data,
   defense value, or house rules leaked into the other.

---

## Pulled Into Scope (quick wins from review)

- **Effort tracking** — reuses the LUCK pip mechanism (Phase 7)
- **Spirit stat blocks** — 2–3 extra NPC tiers, ~20 lines (Phase 6)
- **`auto_initiative` checkbox** — costs nothing now; future initiative
  tracker reads it instead of needing a sheet migration (Phase 1)

## Known Loose Ends

- ~~Stabilize is clicked from the downed player's own sheet~~ RESOLVED: the
  simple health review window (any player can open it on a downed character)
  now carries a STABILIZE button that rolls the VIEWER's Heal skill — the
  ally's Main Action, per RAW. The self-sheet button remains as a fallback.
- ~~DELUXE tab always visible~~ RESOLVED: the DELUXE tab (spellcasting +
  summoning) is hidden on player and admin sheet windows while the
  `cwn_deluxe` house rule is off; toggling it live updates open windows.
- **Strain sources are manual**: the LONG_REST admin button handles recovery
  (-1 all CWN sheets), but +1 strain on rapid healing / overcasting is
  adjusted by hand on the sheet.

## Out of Scope (Future)

- Initiative tracker (see `INITIATIVE_SYSTEMS.md`)
- Hacking / Cyberspace (complex subsystem, own phase)
- Drone & Vehicle combat
- Major injury table automation (QRD is CC BY-NC, so embedding the table is
  allowed — but the trigger-detection + GM-prompt flow is real work)
- Spell list / full spellcasting automation (effort tracking is in scope)
