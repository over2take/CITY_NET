# City Ambience — Feature Plan

Branch: `feature/city-ambience`

Three layered features that add life and visual noise to the map.
Each is independent and can be shipped separately.

---

## 1. Sidewalks

Flat pavement rings rendered around the base of structures.

### DB
- `locations`: add `has_sidewalk INTEGER DEFAULT 1`
- Migration: `ALTER TABLE locations ADD COLUMN has_sidewalk INTEGER DEFAULT 1`

### Backend
- Include `has_sidewalk` in GET responses (already covered by `SELECT *`)
- Accept `has_sidewalk` in location PATCH route

### Frontend — geometry
- New component `Sidewalks.tsx` (or inline in `Buildings.tsx`)
- For each structure where `has_sidewalk = 1`, extrude a flat ring around its XZ footprint
- Width: fixed constant (e.g. `SIDEWALK_WIDTH = 1.5`)
- Height: sits just above ground (`y = 0.02`)
- Shape: respects the building's `shape` field (box → rectangle ring, cylinder/poly → approximated)
- Material: `meshBasicMaterial`, theme-colored (`theme.border` at ~40% opacity)

### Frontend — admin UI
- Global toggle: checkbox in the admin panel header ("RENDER SIDEWALKS")
- Per-structure: checkbox in the edit form ("SIDEWALK") bound to `has_sidewalk`
- State flows through existing location PATCH

### Theme
- Color: `theme.border` (matches road/overpass surface tone)
- Optional edge glow strip: `theme.highlight` at low opacity — Fable pass

---

## 2. Auto-Signage

Randomly placed animated signs on structure faces. No admin placement needed —
signs are generated procedurally at render time from a seeded RNG per structure ID.

### DB
- `locations`: add `has_signage INTEGER DEFAULT 1`
- Migration: `ALTER TABLE locations ADD COLUMN has_signage INTEGER DEFAULT 1`

### Backend
- Include `has_signage` in GET (covered by `SELECT *`)
- Accept `has_signage` in location PATCH route

### Frontend — sign types (start with these, add more)
| Type | Description |
|------|-------------|
| `color_wash` | Slow RGB color cycle, no text |
| `glitch_word` | Static cyberpunk word, occasional glitch frame |
| `scroll_text` | Short phrase scrolling horizontally |
| `strobe` | Fast single-color flash |

- Each structure with `has_signage = 1` gets 1–3 signs
- Placement: random face selection seeded by `structure.id` (same every render)
- Size: proportional to wall face area, capped at reasonable max
- All signs use `useFrame` animation; Fable owns the palette and timing

### Frontend — admin UI
- Global toggle: checkbox in admin panel header ("RENDER SIGNAGE")
- Per-structure: checkbox in edit form ("SIGNAGE") bound to `has_signage`

### Theme
- Sign colors pulled from `ThemeContext`: `primary`, `highlight`, `danger`, `friendly`
- Sign glow uses `theme.glow` CSS variable translated to Three.js via `ThemeContext`
- Fable pass: per-theme sign palette variation (e.g. crimson theme → red/white signs)

---

## 3. Custom Signs

Admin-created freestanding signs placed anywhere on the map.

### DB — new table
```sql
CREATE TABLE IF NOT EXISTS signs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  text TEXT NOT NULL,
  x REAL NOT NULL,
  y REAL NOT NULL,
  z REAL NOT NULL,
  rotation_y REAL DEFAULT 0,
  font_size REAL DEFAULT 1.0,
  image_url TEXT,
  use_tv_filter INTEGER DEFAULT 0
);
```

### Backend — new route `/api/signs`
- `GET /` — return all signs
- `POST /` — create sign (auth required), recordAction `sign_create`
- `PATCH /:id` — update sign (auth required), recordAction `sign_update`
- `DELETE /:id` — delete sign (auth required), recordAction `sign_delete`
- Undo handler: add `sign_create` / `sign_delete` / `sign_update` cases

### Frontend — rendering
- New component `Signs.tsx`
- Each sign is a `<mesh>` with a canvas texture
- Text signs: `canvas.fillText()` re-renders when text/fontSize changes
- Width auto-scales: `signWidth = text.length * fontSize * CHAR_WIDTH_FACTOR`
- Image signs: `<img>` drawn onto canvas, TV filter material overlaid (Fable)
- TV filter: scanline + noise shader, tint from `--scanline-tint` CSS var

### Frontend — admin UI
- New "SIGNS" section in admin panel (draw mode or separate tab)
- Form: text input, font size slider, x/y/z position, rotation slider
- Image URL field (optional) + TV filter toggle
- Click-to-place on map (reuse existing ray-cast pattern from road drawing)

### Theme
- Sign background: `theme.panelBg`
- Sign text: `theme.primary` or `theme.text`
- TV filter tint: per-theme `--scanline-tint`
- Fable pass: font, glow halo, per-theme text color variation

---

## Build Order

1. **Sidewalks** — self-contained, no new routes, ships fast
2. **Auto-signage** — no admin UI beyond two checkboxes, Fable-heavy
3. **Custom signs** — most moving parts, do last

## Work Split

| Task | Owner |
|------|-------|
| DB migrations + PATCH wiring | Sonnet |
| Geometry (sidewalk ring, sign mesh sizing) | Sonnet |
| Backend CRUD for custom signs + undo | Sonnet |
| Admin UI checkboxes + sign form | Sonnet |
| Sign animation (color wash, glitch, scroll, strobe) | Fable |
| TV/CRT filter shader for image signs | Fable |
| Theme palette per sign type | Fable |
| Sidewalk edge glow | Fable |
| Per-theme sign color variation | Fable |

## Security Notes
- Image URLs for custom signs: validate on frontend (no `javascript:`, no data URIs)
- Sign text: sanitise before canvas render (XSS not possible in canvas context, but cap length)
- All write routes require `authenticate` middleware
