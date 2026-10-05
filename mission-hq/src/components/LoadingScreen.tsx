/**
 * Loading.
 *
 * Was a staged "uplink / syncing / calibrating" animation with a radar sweep,
 * which took about four seconds of theatre to say "wait". It made sense when
 * the data really did take four seconds to arrive; now that the same payload
 * comes back from Postgres in a fraction of that, a sequence
 * of fake phases would be slower than the thing it is covering for.
 *
 * So: a quiet line that says what is happening and gets out of the way.
 */
export default function LoadingScreen() {
  return (
    <div className="min-h-dvh grid place-items-center">
      <div className="flex items-center gap-3 text-sm text-gray-500 dark:text-gray-400">
        <span
          className="h-3.5 w-3.5 rounded-full border-2 border-current border-t-transparent animate-spin"
          aria-hidden
        />
        <span>Loading attendance…</span>
      </div>
    </div>
  );
}
