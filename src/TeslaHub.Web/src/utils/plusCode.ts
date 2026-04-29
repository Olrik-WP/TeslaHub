/**
 * Encodes a (latitude, longitude) pair into an Open Location Code
 * (a.k.a. "Plus Code", e.g. `8FVC9G8F+6X`).
 *
 * Why we ship our own encoder instead of `npm i open-location-code`:
 *   - One small algorithm, frozen since 2014, no upstream churn.
 *   - Avoids pulling a transitive dependency and CommonJS/ESM friction
 *     for a ~3 KB function.
 *
 * Why we use Plus Codes for the Tesla "Send to car" feature:
 *   - Tesla's `command/share` parser geocodes any text it receives. If
 *     we hand it raw `lat,lng`, the in-vehicle navigation snaps to the
 *     nearest known address/POI/road segment, often dropping the
 *     destination tens to hundreds of meters off the actual map pin.
 *   - Google Maps URLs (`?q=lat,lng`) help (Tesla recognises them) but
 *     the routing engine still snaps to the closest road for routing,
 *     and the displayed pin can drift if the area has a strong POI.
 *   - Plus Codes are parsed by Tesla as a pure geographic cell, NOT as
 *     a search query. The cell IS the destination, so there is nothing
 *     to fuzzy-match. The community has cross-verified this works for
 *     parking spots, off-road pins, and general meter-precision use.
 *
 * Length / precision (per the OLC spec):
 *   - 10 chars (PAIR_CODE_LENGTH)               → ~14 m × 14 m cell
 *   - 11 chars (recommended default for Tesla)  → ~2.8 m × 3.5 m cell
 *   - 12 chars                                  → ~0.7 m × 0.6 m cell
 *   The recommended 11-char form matches consumer GPS accuracy
 *   (~3 m) so going higher is wasted bits.
 *
 * Algorithm reference:
 *   https://github.com/google/open-location-code/blob/main/docs/specification.md
 *   https://github.com/google/open-location-code/blob/main/js/src/openlocationcode.js
 *   (Apache-2.0)
 */

const CODE_ALPHABET = '23456789CFGHJMPQRVWX';
const ENCODING_BASE = 20;
const LATITUDE_MAX = 90;
const LONGITUDE_MAX = 180;
const MAX_DIGIT_COUNT = 15;
const PAIR_CODE_LENGTH = 10;
const GRID_CODE_LENGTH = MAX_DIGIT_COUNT - PAIR_CODE_LENGTH; // 5
const GRID_COLUMNS = 4;
const GRID_ROWS = 5;
// Multiplier that converts a raw degree value into the pair-section
// integer space (covers up to ~0.000125° per cell at finest pair step).
// Per the OLC reference implementation, this is ENCODING_BASE ** 3 = 8000
// — NOT ENCODING_BASE ** 5. The 2 most-significant pair digits encode
// 20° and 1° per cell respectively and they live OUTSIDE this multiplier.
const PAIR_PRECISION = Math.pow(ENCODING_BASE, 3);
const FINAL_LAT_PRECISION = PAIR_PRECISION * Math.pow(GRID_ROWS, GRID_CODE_LENGTH);
const FINAL_LNG_PRECISION = PAIR_PRECISION * Math.pow(GRID_COLUMNS, GRID_CODE_LENGTH);
const SEPARATOR = '+';
const SEPARATOR_POSITION = 8;

/**
 * Returns the Open Location Code (Plus Code) for the given coordinates.
 * `codeLength` defaults to 11 — the sweet spot for Tesla navigation:
 * ~3 m precision (matching civilian GPS) without unnecessary length.
 */
export function encodePlusCode(
  latitude: number,
  longitude: number,
  codeLength: number = 11,
): string {
  if (codeLength < 2 || (codeLength < PAIR_CODE_LENGTH && codeLength % 2 === 1)) {
    throw new Error(`Invalid Open Location Code length: ${codeLength}`);
  }
  const length = Math.min(codeLength, MAX_DIGIT_COUNT);

  let lat = Math.max(-LATITUDE_MAX, Math.min(LATITUDE_MAX, latitude));
  let lng = longitude;
  while (lng < -LONGITUDE_MAX) lng += 360;
  while (lng >= LONGITUDE_MAX) lng -= 360;

  // Move into a positive integer space to keep all subsequent maths
  // floating-point safe (the same trick the canonical JS library uses).
  let latVal = Math.floor(lat * FINAL_LAT_PRECISION) + LATITUDE_MAX * FINAL_LAT_PRECISION;
  if (latVal < 0) latVal = 0;
  if (latVal >= 2 * LATITUDE_MAX * FINAL_LAT_PRECISION) {
    latVal = 2 * LATITUDE_MAX * FINAL_LAT_PRECISION - 1;
  }
  let lngVal = Math.floor(lng * FINAL_LNG_PRECISION) + LONGITUDE_MAX * FINAL_LNG_PRECISION;
  if (lngVal < 0) {
    lngVal = (lngVal % (2 * LONGITUDE_MAX * FINAL_LNG_PRECISION)) +
      2 * LONGITUDE_MAX * FINAL_LNG_PRECISION;
  } else if (lngVal >= 2 * LONGITUDE_MAX * FINAL_LNG_PRECISION) {
    lngVal = lngVal % (2 * LONGITUDE_MAX * FINAL_LNG_PRECISION);
  }

  let code = '';

  if (length > PAIR_CODE_LENGTH) {
    // Grid section — 4×5 sub-cells per refinement step, each character
    // contributes one extra grid digit so each step shrinks the cell by
    // a factor of 20 in area.
    for (let i = 0; i < GRID_CODE_LENGTH; i++) {
      const latDigit = latVal % GRID_ROWS;
      const lngDigit = lngVal % GRID_COLUMNS;
      code = CODE_ALPHABET.charAt(latDigit * GRID_COLUMNS + lngDigit) + code;
      latVal = Math.floor(latVal / GRID_ROWS);
      lngVal = Math.floor(lngVal / GRID_COLUMNS);
    }
  } else {
    // Drop the grid bits when the caller only wanted pair-precision.
    latVal = Math.floor(latVal / Math.pow(GRID_ROWS, GRID_CODE_LENGTH));
    lngVal = Math.floor(lngVal / Math.pow(GRID_COLUMNS, GRID_CODE_LENGTH));
  }

  // Pair section — 5 (lat, lng) pairs = 10 digits, separator goes in
  // after the first 8 digits so the output is "XXXXXXXX+XX" style.
  for (let i = 0; i < PAIR_CODE_LENGTH / 2; i++) {
    code = CODE_ALPHABET.charAt(lngVal % ENCODING_BASE) + code;
    code = CODE_ALPHABET.charAt(latVal % ENCODING_BASE) + code;
    latVal = Math.floor(latVal / ENCODING_BASE);
    lngVal = Math.floor(lngVal / ENCODING_BASE);
    if (i === 0) {
      code = SEPARATOR + code;
    }
  }

  // The full code is 16 chars (15 digits + 1 separator); trim back to
  // the requested length, keeping the separator intact.
  if (length >= SEPARATOR_POSITION) {
    return code.substring(0, length + 1);
  }
  // Padding-character branch is unreachable here because we always ask
  // for length >= SEPARATOR_POSITION (>= 8), but kept for completeness
  // matching the reference implementation.
  return (
    code.substring(0, length) +
    new Array(SEPARATOR_POSITION - length + 1).join('0') +
    SEPARATOR
  );
}
