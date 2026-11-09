import type { NavigationState } from "../viewer/navigation";

// What Settings' activity card shows: a year of trips day by day, then records
// and totals, all read from the trips and places saved on each map.

/** Weeks in the graph, Monday first, ending with this week. */
export const WEEKS = 52;
const DAY = 86_400_000;

const midnight = (time: number) => new Date(time).setHours(0, 0, 0, 0);
/** Midnight on the Monday of the week holding `time`. */
const monday = (time: number) => {
  const date = new Date(midnight(time));
  date.setDate(date.getDate() - ((date.getDay() + 6) % 7));
  return date.getTime();
};
const minutesBetween = (from: number, to: number) => Math.max(0, Math.round((to - from) / 60_000));

export type Activity = ReturnType<typeof summarizeActivity>;

/** Totals over every map, and minutes on site for each day of the graph. */
export function summarizeActivity(
  maps: { name: string; navigation: Pick<NavigationState, "trips" | "markers" | "routes"> }[],
  now = Date.now(),
) {
  const first = new Date(monday(now));
  first.setDate(first.getDate() - (WEEKS - 1) * 7);
  // Rounded, since a day across a clock change is an hour short or long.
  const dayIndex = (time: number) => Math.round((midnight(time) - first.getTime()) / DAY);
  const days = new Array<number>(WEEKS * 7).fill(0);
  const weeks = new Set<number>();
  let trips = 0, minutes = 0, places = 0, photos = 0;
  let longest: { minutes: number; started: number } | undefined;
  let favourite: { name: string; trips: number } | undefined;
  for (const { name, navigation } of maps) {
    places += navigation.markers.length;
    for (const item of [...navigation.markers, ...navigation.routes]) photos += item.photos?.length ?? 0;
    for (const trip of navigation.trips) {
      const started = trip.points[0]?.time ?? trip.ended, length = minutesBetween(started, trip.ended);
      trips++;
      minutes += length;
      if (!longest || length > longest.minutes) longest = { minutes: length, started };
      weeks.add(monday(started));
      const index = dayIndex(started);
      // Even a short trip shows on its day.
      if (index >= 0 && index < days.length) days[index]! += Math.max(1, length);
    }
    if (navigation.trips.length > (favourite?.trips ?? 0)) favourite = { name, trips: navigation.trips.length };
  }
  // Weeks in a row with a trip: the best run, and the one still going this week or last.
  let best = 0, run = 0, previous: number | undefined;
  for (const week of [...weeks].sort((a, b) => a - b)) {
    run = previous !== undefined && monday(week - DAY) === previous ? run + 1 : 1;
    best = Math.max(best, run);
    previous = week;
  }
  let streak = 0;
  for (let week = weeks.has(monday(now)) ? monday(now) : monday(monday(now) - DAY); weeks.has(week); week = monday(week - DAY)) streak++;
  return {
    /** Midnight on the graph's first Monday. */
    first: first.getTime(), days, today: dayIndex(now),
    trips, minutes, places, photos, longest, favourite, streak, best,
    daysOut: days.filter(Boolean).length,
  };
}

/** How bright a day shows: faint for a short visit, full from four hours on site. */
export const dayLevel = (minutes: number) => Math.min(1, 0.35 + (minutes / 240) * 0.65);
