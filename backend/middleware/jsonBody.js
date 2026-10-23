const express = require('express');

// The one JSON body reader for every route (1.14.10). It refuses a compressed request body
// (Content-Encoding: br, gzip or deflate) with 415 rather than decompressing it.
//
// Node's October 2026 security release (CVE-2026-111497) fixed an out-of-bounds write in its
// Brotli decoder, and express.json() decompresses any request body labelled br with it: anyone
// who could reach a server could send one, signed in or not. No browser compresses what it sends
// to our API, so nothing needs it; refusing it keeps every decoder out of reach of a request,
// whatever Node a manual install runs on.

/** Read a JSON body of up to `limit`, never a compressed one. */
const jsonBody = (limit = '2mb') => express.json({ limit, inflate: false });

/**
 * Read a zip sent as its own bytes (a system and its pictures, routes/systems.js), up to `limit`,
 * as a Buffer, and on the same terms: a zip is compressed inside, never as it is sent, so a body
 * labelled br, gzip or deflate is refused rather than decompressed. Only bodies sent as
 * application/zip; any other is left unread.
 */
const zipBody = (limit) => express.raw({ type: 'application/zip', limit, inflate: false });

module.exports = { jsonBody, zipBody };
