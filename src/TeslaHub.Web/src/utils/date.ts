/**
 * TeslaMate stores dates as PostgreSQL "timestamp without time zone" in UTC.
 * Npgsql returns these as DateTime(Kind=Unspecified), so JSON serialization
 * omits the 'Z' suffix. JavaScript then treats the ISO string as local time.
 *
 * This helper appends 'Z' when missing so the browser correctly converts to
 * the user's local timezone.
 */
export function utcDate(iso: string | null | undefined): Date {
  if (!iso) return new Date(NaN);
  return iso.endsWith('Z') || iso.includes('+') || iso.includes('-', 19)
    ? new Date(iso)
    : new Date(iso + 'Z');
}
