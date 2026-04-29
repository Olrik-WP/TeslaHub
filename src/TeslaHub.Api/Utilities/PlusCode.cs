namespace TeslaHub.Api.Utilities;

/// <summary>
/// Encoder for Open Location Codes (a.k.a. "Plus Codes"), e.g.
/// <c>8FVC9G8F+6X</c>.
///
/// Why we ship our own encoder instead of `Google.OpenLocationCode`:
///   - One small, frozen-since-2014 algorithm; no transitive
///     dependency required.
///   - Keeps the file count for the Tesla integration self-contained.
///
/// Why TeslaHub uses Plus Codes for "Send to car":
///   - Tesla's <c>command/share</c> parser geocodes any text it
///     receives. Raw <c>lat,lng</c>, <c>"Address\nlat,lng"</c> and even
///     <c>https://maps.google.com/?q=lat,lng</c> URLs all funnel through
///     a fuzzy address resolver and snap the displayed destination to
///     the closest known POI/road, drifting tens to hundreds of meters
///     off the actual pin.
///   - Plus Codes are parsed as a pure geographic cell — there is no
///     address resolution, no POI fuzzing. The cell IS the destination.
///   - Cross-verified by the Tesla owner community as the most reliable
///     way to drop a destination on an exact spot (parking spaces,
///     trailheads, off-road pins, …).
///
/// Length / precision (per the OLC spec):
///   - 10 chars (PAIR_CODE_LENGTH)               → ~14 m × 14 m cell
///   - 11 chars (recommended for Tesla nav)      → ~2.8 m × 3.5 m cell
///   - 12 chars                                  → ~0.7 m × 0.6 m cell
///
/// Algorithm reference:
///   https://github.com/google/open-location-code/blob/main/docs/specification.md
///   https://github.com/google/open-location-code/blob/main/js/src/openlocationcode.js
///   (Apache-2.0, ported faithfully).
/// </summary>
public static class PlusCode
{
    private const string CodeAlphabet = "23456789CFGHJMPQRVWX";
    private const int EncodingBase = 20;
    private const int LatitudeMax = 90;
    private const int LongitudeMax = 180;
    private const int MaxDigitCount = 15;
    private const int PairCodeLength = 10;
    private const int GridCodeLength = MaxDigitCount - PairCodeLength; // 5
    private const int GridColumns = 4;
    private const int GridRows = 5;
    private const char Separator = '+';
    private const int SeparatorPosition = 8;

    // PAIR_PRECISION = ENCODING_BASE^3 = 8000. NOT EncodingBase^5 — the
    // two most-significant pair digits encode 20° / 1° per cell and live
    // OUTSIDE this multiplier. Match the canonical reference exactly,
    // misreading this constant produces codes that are ~400× too coarse.
    private const long PairPrecision = 8000L; // 20^3
    private const long FinalLatPrecision = PairPrecision * 3125L; // * 5^5
    private const long FinalLngPrecision = PairPrecision * 1024L; // * 4^5

    /// <summary>
    /// Encodes the given latitude/longitude into a Plus Code. The default
    /// length of 11 characters yields ~3 m precision — the sweet spot
    /// for Tesla in-vehicle navigation (matches civilian GPS accuracy
    /// without wasting bits).
    /// </summary>
    public static string Encode(double latitude, double longitude, int codeLength = 11)
    {
        if (codeLength < 2 || (codeLength < PairCodeLength && codeLength % 2 == 1))
            throw new ArgumentOutOfRangeException(nameof(codeLength),
                $"Invalid Open Location Code length: {codeLength}");

        var length = Math.Min(codeLength, MaxDigitCount);

        var lat = Math.Max(-LatitudeMax, Math.Min(LatitudeMax, latitude));
        var lng = longitude;
        while (lng < -LongitudeMax) lng += 360;
        while (lng >= LongitudeMax) lng -= 360;

        // Move into a positive integer space to keep all subsequent
        // arithmetic floating-point safe (mirrors the canonical lib).
        long latVal = (long)Math.Floor(lat * FinalLatPrecision) + (long)LatitudeMax * FinalLatPrecision;
        if (latVal < 0) latVal = 0;
        if (latVal >= 2L * LatitudeMax * FinalLatPrecision)
            latVal = 2L * LatitudeMax * FinalLatPrecision - 1;

        long lngVal = (long)Math.Floor(lng * FinalLngPrecision) + (long)LongitudeMax * FinalLngPrecision;
        var lngRange = 2L * LongitudeMax * FinalLngPrecision;
        if (lngVal < 0)
            lngVal = (lngVal % lngRange) + lngRange;
        else if (lngVal >= lngRange)
            lngVal %= lngRange;

        var code = string.Empty;

        if (length > PairCodeLength)
        {
            // Grid section — 4×5 sub-cells per refinement step. Each
            // additional grid character shrinks the cell area by 20×.
            for (var i = 0; i < GridCodeLength; i++)
            {
                var latDigit = (int)(latVal % GridRows);
                var lngDigit = (int)(lngVal % GridColumns);
                code = CodeAlphabet[latDigit * GridColumns + lngDigit] + code;
                latVal /= GridRows;
                lngVal /= GridColumns;
            }
        }
        else
        {
            latVal /= (long)Math.Pow(GridRows, GridCodeLength);
            lngVal /= (long)Math.Pow(GridColumns, GridCodeLength);
        }

        // Pair section — 5 (lat, lng) pairs = 10 digits, separator
        // inserted right after the first 8 digits (XXXXXXXX+XX layout).
        for (var i = 0; i < PairCodeLength / 2; i++)
        {
            code = CodeAlphabet[(int)(lngVal % EncodingBase)] + code;
            code = CodeAlphabet[(int)(latVal % EncodingBase)] + code;
            latVal /= EncodingBase;
            lngVal /= EncodingBase;
            if (i == 0) code = Separator + code;
        }

        if (length >= SeparatorPosition)
            return code[..(length + 1)];

        return code[..length] + new string('0', SeparatorPosition - length) + Separator;
    }
}
