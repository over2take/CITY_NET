// Seat layouts, as the vehicle window draws them.
//
// The seat ids mirror backend/sheets/vehicleLayouts.js, which is the canonical list — the
// server validates against it, so a seat offered here that it does not know would be a
// control that fails when used. A test pins the two together.
//
// Anchors are percentages of the diagram box: `seat` is where the marker sits on the
// vehicle, `label` is where its name goes. `side` puts the leader line's text on the left
// or right so the two columns stay clear of the vehicle in the middle.

export interface Seat {
  id: string;
  label: string;
  seat: { x: number; y: number };
  label_at: { x: number; y: number };
  side: 'left' | 'right';
}

export interface VehicleLayout {
  id: string;
  label: string;
  seats: Seat[];
}

export const VEHICLE_LAYOUTS: Record<string, VehicleLayout> = {
  bike: {
    id: 'bike',
    label: 'BIKE',
    seats: [
      { id: 'driver', label: 'RIDER', seat: { x: 50, y: 40 }, label_at: { x: 12, y: 34 }, side: 'left' },
      { id: 'pillion', label: 'PILLION', seat: { x: 50, y: 62 }, label_at: { x: 88, y: 68 }, side: 'right' },
    ],
  },
  car: {
    id: 'car',
    label: 'CAR',
    seats: [
      { id: 'driver', label: 'DRIVER', seat: { x: 36, y: 34 }, label_at: { x: 11, y: 22 }, side: 'left' },
      { id: 'shotgun', label: 'SHOTGUN', seat: { x: 64, y: 34 }, label_at: { x: 89, y: 22 }, side: 'right' },
      { id: 'back_left', label: 'B.LEFT', seat: { x: 36, y: 52 }, label_at: { x: 11, y: 44 }, side: 'left' },
      { id: 'back_right', label: 'B.RIGHT', seat: { x: 64, y: 52 }, label_at: { x: 89, y: 44 }, side: 'right' },
      { id: 'gunner', label: 'GUNNER', seat: { x: 50, y: 68 }, label_at: { x: 11, y: 80 }, side: 'left' },
    ],
  },
  van: {
    id: 'van',
    label: 'VAN',
    seats: [
      { id: 'driver', label: 'DRIVER', seat: { x: 36, y: 26 }, label_at: { x: 11, y: 16 }, side: 'left' },
      { id: 'shotgun', label: 'SHOTGUN', seat: { x: 64, y: 26 }, label_at: { x: 89, y: 16 }, side: 'right' },
      { id: 'mid_left', label: 'M.LEFT', seat: { x: 36, y: 44 }, label_at: { x: 11, y: 36 }, side: 'left' },
      { id: 'mid_right', label: 'M.RIGHT', seat: { x: 64, y: 44 }, label_at: { x: 89, y: 36 }, side: 'right' },
      { id: 'back_left', label: 'B.LEFT', seat: { x: 36, y: 62 }, label_at: { x: 11, y: 56 }, side: 'left' },
      { id: 'back_right', label: 'B.RIGHT', seat: { x: 64, y: 62 }, label_at: { x: 89, y: 56 }, side: 'right' },
      { id: 'gunner', label: 'GUNNER', seat: { x: 50, y: 78 }, label_at: { x: 11, y: 88 }, side: 'left' },
    ],
  },
};

/** Vehicles that never had a layout set are cars, which is what most of them are. */
export const DEFAULT_VEHICLE_LAYOUT = 'car';

export const getVehicleLayout = (id: string | null | undefined): VehicleLayout =>
  VEHICLE_LAYOUTS[String(id ?? '').trim().toLowerCase()] ?? VEHICLE_LAYOUTS[DEFAULT_VEHICLE_LAYOUT];

/** Choices for the layout field on the sheet. */
export const VEHICLE_LAYOUT_OPTIONS = Object.values(VEHICLE_LAYOUTS).map(l => ({ value: l.id, label: l.label }));
