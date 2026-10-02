/**
 * UK wall-clock time, whatever clock the server runs on.
 *
 * "Post at 09:00 on Monday" means 09:00 in Britain. Worked out from the server's own clock it was
 * right on this PC and an hour late all summer on a server in UTC, and the week of the weekly score
 * began at 01:00 on Monday. Everything that means a UK hour or a UK day asks here.
 */
const FMT = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/London', hourCycle: 'h23',
  year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short',
});
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** The date and time in Britain at this instant. `weekday` is 0 for Sunday, as Date.getDay() gives. */
export function ukParts(d = new Date()): { year: number; month: number; day: number; hour: number; minute: number; weekday: number } {
  const p = Object.fromEntries(FMT.formatToParts(d).map(x => [x.type, x.value]));
  return { year: Number(p.year), month: Number(p.month), day: Number(p.day), hour: Number(p.hour), minute: Number(p.minute), weekday: DAYS.indexOf(p.weekday) };
}

/** The instant at which a clock in Britain reads this date and hour. `day` may run past the month's end. */
export function ukInstant(year: number, month: number, day: number, hour: number): Date {
  const guess = Date.UTC(year, month - 1, day, hour);
  const p = ukParts(new Date(guess));
  const offset = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute) - guess;   // an hour in summer, nothing in winter
  return new Date(guess - offset);
}
