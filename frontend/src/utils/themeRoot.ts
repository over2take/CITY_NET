// Where a portalled window has to be mounted for the theme to reach it.
//
// The seven themes are CSS variables set by a `theme-*` class on `.crt-container`, which
// is a div inside the app rather than the document root. A window portalled to
// `document.body` therefore lands *outside* that class, every `var(--green)` in it falls
// back to the `:root` defaults, and it renders in Classic green while the rest of the app
// is Vaporwave. It looks like the component forgot to use variables when in fact it was
// mounted somewhere the variables do not exist.
//
// Portalling into the container instead keeps the cascade. It is safe to do: the container
// is `position: relative` with no transform, filter or overflow, so a fixed-position window
// inside it still positions against the viewport and nothing clips it — which is the reason
// these windows are portalled in the first place.

/**
 * The element a floating window should be portalled into.
 *
 * Falls back to `document.body` when the container is not there — in a test, or before the
 * app has mounted. Colours are wrong in that case rather than the window being missing,
 * which is the right way round for a fallback.
 */
export const themeRoot = (): Element =>
  document.querySelector('.crt-container') ?? document.body;
