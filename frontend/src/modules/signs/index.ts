// Custom signs: the meshes players place, and the procedural signage that dresses the city.
//
// Two things share this module because they draw the same kind of object, not because they
// are the same feature. Signs are placed by hand, stored in the database and editable;
// AutoSignage is generated from where the buildings are and stored nowhere.
//
// The editor UI lives in AdminPanel for now — see components/SignEditor once it moves.

export { Signs } from './components/Signs';
export { AutoSignage } from './components/AutoSignage';
export type { SignData, SignLine } from './components/Signs';
