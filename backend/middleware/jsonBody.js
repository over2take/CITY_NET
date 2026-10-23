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

module.exports = { jsonBody };
