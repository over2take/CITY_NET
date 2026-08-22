const multer = require('multer');
const path = require('path');

// What an upload is allowed to be, and how to say so when it is not.
//
// The rejections here were each written where they were needed, so they each said a
// different amount: one listed the formats, one said "unsupported file type" and nothing
// else, and the size limit said nothing at all — it was never handled, so an oversized
// file reached multer's own error, fell through to Express's default handler, and came
// back as an HTML page that the client then tried to parse as JSON. What a person saw for
// uploading a large map was a syntax error.
//
// A rejection should answer the three questions the person actually has: which file, what
// was wrong with it, and what would have worked.

/** One megabyte, so the numbers below read as the units people think in. */
const MB = 1024 * 1024;

/**
 * The ceiling for each kind of upload, in bytes.
 *
 * These are memory figures as much as policy ones: multer buffers the whole file and the
 * routes hash it before writing, so the limit is really how much of a home server's RAM
 * one upload may take. Raising the map ceiling for animated maps means either accepting
 * that cost or streaming to disk while hashing.
 */
const LIMITS = {
  battle_map: 25 * MB,
  music: 25 * MB,
  portrait: 8 * MB,
  font: 5 * MB,
};

const asMb = (bytes) => `${(bytes / MB).toFixed(bytes < MB ? 2 : 1)}MB`;

/**
 * A sentence naming the file, what was wrong, and what would have worked.
 *
 * Deliberately one string rather than a structured payload: every one of these ends up in
 * a small red line in a dialog, and a client assembling its own wording from parts is how
 * the two drift apart again.
 */
function describeRejection({ filename, reason, allowed, maxBytes, size }) {
  const named = filename ? `"${filename}"` : 'That file';
  const ext = filename ? path.extname(filename).toLowerCase() : '';

  if (reason === 'size') {
    return `${named} is ${asMb(size)}, over the ${asMb(maxBytes)} limit.`;
  }

  const was = ext ? `is ${ext}` : 'has no file extension';
  const list = allowed.join(', ');
  return `${named} ${was}, which is not supported. Use ${list} — up to ${asMb(maxBytes)}.`;
}

/** Refuse an upload whose format is not on the list, saying which and why. */
function rejectFormat(res, { file, allowed, maxBytes }) {
  return res.status(400).json({
    error: describeRejection({
      filename: file && file.originalname,
      reason: 'format',
      allowed,
      maxBytes,
    }),
    reason: 'UNSUPPORTED_FORMAT',
    allowed,
    maxBytes,
  });
}

/**
 * Turn multer's own failures into the same shape as ours.
 *
 * Mounted per route rather than globally: the limit and the format list differ by upload,
 * and a shared handler would have to guess which one it was speaking for. Note that the
 * size is not known here — multer aborts partway, which is the point of a limit — so the
 * message gives the ceiling rather than pretending to know what was sent.
 */
function uploadErrors({ allowed, maxBytes }) {
  return (err, req, res, next) => {
    if (!(err instanceof multer.MulterError)) return next(err);

    if (err.code === 'LIMIT_FILE_SIZE') {
      const named = req.uploadFilename ? `"${req.uploadFilename}"` : 'That file';
      return res.status(413).json({
        error: `${named} is over the ${asMb(maxBytes)} limit.`,
        reason: 'FILE_TOO_LARGE',
        allowed,
        maxBytes,
      });
    }

    return res.status(400).json({
      error: `That upload could not be read (${err.code}).`,
      reason: err.code,
      allowed,
      maxBytes,
    });
  };
}

module.exports = { LIMITS, MB, describeRejection, rejectFormat, uploadErrors, asMb };
