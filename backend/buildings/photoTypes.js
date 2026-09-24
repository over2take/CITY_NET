// What a building photo may be. Stills only, and only what an `<img>` will show.
//
// Narrower than a battle map on purpose. There is no call for a looping photo, and SVG,
// which the battle-map list keeps for floor plans, is a drawing rather than a photograph.
//
// Its own module, requiring nothing, so the frontend test can hold the file picker's
// `accept` list to it - see crossBoundaryImports.test.ts for why a module a frontend test
// reaches into must not pull in a package.

const PHOTO_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.avif']);

module.exports = { PHOTO_EXT };
