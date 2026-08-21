// How the browser is allowed to treat a file somebody uploaded.
//
// Everything under `/uploads` is served with no authentication, and all of it arrived from
// outside. The upload routes decide what may be written; this decides what a browser will
// do with it once it is — which are different questions, and only the second one is still
// true for files that were already on disk before an allowlist existed.
//
// Two headers:
//
//   - `Content-Security-Policy: sandbox` puts the response in an opaque origin. A document
//     opened directly from here has no access to anything of ours — no cookies, no
//     localStorage, no same-origin fetch — so script inside it has nothing to reach. This
//     is what makes SVG safe to accept: in an `<img>` it could never execute anyway, and
//     navigating straight to the file is the one case where it could.
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
