// How the browser is allowed to treat a file somebody uploaded.
//
// Everything under `/uploads` is served with no authentication, and all of it arrived from
// outside. The upload routes decide what may be written; this decides what a browser will
// do with it once it is — which are different questions, and only the second one is still
// true for files that were already on disk before an allowlist existed.
//
// Two headers:
//
//   - `Content-Security-Policy: sandbox` with no `allow-scripts`. Checked in a browser
//     rather than assumed, and it is stronger than an opaque origin: a document opened
//     directly from here does not run script at all — Chrome refuses with "Blocked script
//     execution ... because the document's frame is sandboxed". This is what makes SVG
//     safe to accept: in an `<img>` it could never execute anyway, and navigating straight
//     to the file is the one case where it could.
//
//     The same check confirmed the other half, which matters more: a PNG and an SVG both
//     still load normally as `<img>` through this mount. CSP on a subresource response is
//     not applied to the page using it, so battle maps and portraits are untouched — that
//     was the regression worth being sure about, since every one of them comes from here.
//   - `X-Content-Type-Options: nosniff` stops a browser deciding for itself that a file is
//     HTML despite what it was served as.
//
// Deliberately defence in depth. It is what lets the upload allowlists stay as wide as the
// file pickers, because a GM's choice of map format should not be a security decision.

const setUploadHeaders = (res) => {
  res.setHeader('Content-Security-Policy', 'sandbox');
  res.setHeader('X-Content-Type-Options', 'nosniff');
};

module.exports = { setUploadHeaders };
