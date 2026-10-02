/**
 * One write to Google at a time per thing being written.
 *
 * Google makes a new post or a new photo on every call, so two presses that overlap (two tabs, a
 * double click, the scheduler and a person in the same second) must not both send. Checking the
 * row's status is not enough: both calls read it before either has changed it. This app is one
 * process, so the claim is held in memory, on globalThis so a reloaded module shares it, and is
 * taken before the first await. Nothing is left behind if the process stops mid-send, which a
 * 'sending' status in the database would be.
 */
declare global {
  // eslint-disable-next-line no-var
  var __gbpInFlight: Set<string> | undefined;
}

export async function exclusive<T>(key: string, busy: string, fn: () => Promise<T>): Promise<T> {
  const held = (globalThis.__gbpInFlight ??= new Set<string>());
  if (held.has(key)) throw new Error(busy);
  held.add(key);
  try { return await fn(); } finally { held.delete(key); }
}
