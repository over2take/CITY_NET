# Initiative Systems Reference

This document captures how each supported TTRPG system handles initiative, so the future initiative tracker can be implemented correctly per system.

Initiative is **not yet built** into the app. This doc preserves the rules for when that work begins.

---

## Cyberpunk Red (CP:R)

**Roll**: `1d10 + REF stat`
- No skill modifier — REF alone determines speed
- Higher result acts first
- Ties: both sides roll off, or GM decides

**Turn order**: highest to lowest, each character acts once per round

**Notes for tracker**:
- Need: `ref` field from sheet, d10 roll + REF
- No tie-breaking rule is defined in the rules — treat as simultaneous or roll-off prompt for GM

**Source**: CP:R Core Rulebook

---

## Cities Without Number (CWN)

**Roll**: `1d8 + best DEX modifier among all acting characters`

Wait — this is a **group initiative** variant. The exact per-character form is:

**Per-character initiative**: `1d8 + character's DEX modifier`
- Highest result acts first; work down the list
- **PCs win ties** against NPCs

**Automatic initiative** (character-level features):
- Certain Foci (e.g., Alert, Gunslinger) and cyberware can grant:
  - Act before the rest of the initiative order on the first round
  - Immune to surprise
  - Automatic initiative (always first, no roll needed)
- These are character-level flags, not a dice mechanic

**Notes for tracker**:
- Need: `dex_mod` from CWN sheet
- Roll: `1d8 + dex_mod`
- PC vs NPC tie-breaking: PCs win
- Flag field: `auto_initiative` (boolean) — acts first regardless of roll; comes from Foci/cyberware
- NPCs do not have individual DEX mods — use GM-assigned modifier (0 by default, vary by tier)

**Source**: CWN Quick Reference Documents v2.2

---

## Future Tracker Requirements

When the initiative tracker is built, it needs to:

1. **Know which system is active** — read `active_system` from global settings
2. **Load the correct roll formula** per system (see above)
3. **Support tie-breaking rules** — CP:R (no rule / GM call), CWN (PCs win)
4. **Support auto-initiative flags** — CWN Foci/cyberware; place flagged characters at the top without rolling
5. **Show turn order list** — sorted, with current actor highlighted
6. **Support round tracking** — increment round counter, wrap back to top after last actor
7. **GM controls**: add/remove combatants mid-fight, manually reorder, hold/delay action
8. **Socket broadcast**: turn order changes should emit to all connected clients so players see who's up

### Suggested Data Model

```json
{
  "round": 1,
  "combatants": [
    {
      "id": "uuid",
      "name": "Rye Nakamura",
      "type": "pc",
      "roll": 9,
      "modifier": 2,
      "total": 11,
      "auto_initiative": false,
      "acted": false
    },
    {
      "id": "uuid",
      "name": "Street Punk",
      "type": "npc",
      "roll": 6,
      "modifier": 0,
      "total": 6,
      "auto_initiative": false,
      "acted": false
    }
  ],
  "current_index": 0,
  "system": "cyberpunk_red"
}
```

---

## Systems Not Yet Researched

Add initiative rules here as new systems are added to the app:

- [ ] D&D 5e / D20 system
- [ ] Call of Cthulhu
- [ ] Shadowrun
