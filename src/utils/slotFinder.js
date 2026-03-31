import {
  addDays,
  addMinutes,
  endOfDay,
  format,
  formatISO,
  isAfter,
  isBefore,
  parseISO,
  startOfDay,
} from "date-fns";

function getDayPartRange(dayPart) {
  switch (dayPart) {
    case "morning":
      return { startHour: 8, endHour: 12 };
    case "afternoon":
      return { startHour: 12, endHour: 17 };
    case "evening":
      return { startHour: 17, endHour: 22 };
    default:
      return { startHour: 8, endHour: 18 };
  }
}

function overlaps(candidateStart, candidateEnd, busyIntervals) {
  return busyIntervals.some((busy) => {
    const busyStart = parseISO(busy.start);
    const busyEnd = parseISO(busy.end);
    return isBefore(candidateStart, busyEnd) && isAfter(candidateEnd, busyStart);
  });
}

function getLastMeetingEndOnDay(day, busyIntervals) {
  const dayStart = startOfDay(day);
  const dayEnd = endOfDay(day);
  const dayBusy = busyIntervals
    .map((busy) => ({ start: parseISO(busy.start), end: parseISO(busy.end) }))
    .filter(
      (busy) =>
        isAfter(busy.start, dayStart) &&
        isBefore(busy.start, dayEnd) &&
        isAfter(busy.end, dayStart) &&
        isBefore(busy.end, dayEnd),
    );

  if (!dayBusy.length) return null;
  return dayBusy.reduce(
    (latest, interval) => (isAfter(interval.end, latest) ? interval.end : latest),
    dayBusy[0].end,
  );
}

export function findAvailableSlots({
  constraints,
  busyIntervals,
  timezone,
  maxSlots = 5,
}) {
  const durationMinutes = constraints.durationMinutes || 30;
  const windowStart = constraints.windowStartISO
    ? parseISO(constraints.windowStartISO)
    : new Date();
  const windowEnd = constraints.windowEndISO
    ? parseISO(constraints.windowEndISO)
    : addDays(new Date(), 14);

  const range = getDayPartRange(constraints.dayPart || "any");
  const preferredDays = constraints.preferredDays || [];
  const avoidDays = constraints.avoidDays || [];
  const notBeforeHour = constraints.notBeforeHour ?? range.startHour;
  const hardEndHour = constraints.notAfterHour ?? range.endHour;

  const slots = [];
  let dayCursor = startOfDay(windowStart);

  while (isBefore(dayCursor, windowEnd) && slots.length < maxSlots) {
    const dayIndex = dayCursor.getDay();
    if (avoidDays.includes(dayIndex)) {
      dayCursor = addDays(dayCursor, 1);
      continue;
    }
    if (preferredDays.length && !preferredDays.includes(dayIndex)) {
      dayCursor = addDays(dayCursor, 1);
      continue;
    }

    const firstStart = new Date(dayCursor);
    firstStart.setHours(notBeforeHour, 0, 0, 0);
    const dayEnd = new Date(dayCursor);
    dayEnd.setHours(hardEndHour, 0, 0, 0);

    const lastMeetingEnd = constraints.afterLastMeetingBufferMinutes
      ? getLastMeetingEndOnDay(dayCursor, busyIntervals)
      : null;
    const minStartWithBuffer = lastMeetingEnd
      ? addMinutes(lastMeetingEnd, constraints.afterLastMeetingBufferMinutes)
      : null;

    let candidateStart = firstStart;
    while (isBefore(candidateStart, dayEnd) && slots.length < maxSlots) {
      const candidateEnd = addMinutes(candidateStart, durationMinutes);
      if (isAfter(candidateEnd, dayEnd)) {
        break;
      }
      if (isBefore(candidateStart, windowStart) || isAfter(candidateEnd, windowEnd)) {
        candidateStart = addMinutes(candidateStart, 30);
        continue;
      }
      if (minStartWithBuffer && isBefore(candidateStart, minStartWithBuffer)) {
        candidateStart = addMinutes(candidateStart, 30);
        continue;
      }
      if (!overlaps(candidateStart, candidateEnd, busyIntervals)) {
        slots.push({
          startISO: formatISO(candidateStart),
          endISO: formatISO(candidateEnd),
          label: format(candidateStart, "EEE MMM d, h:mm a"),
          timezone,
        });
      }

      candidateStart = addMinutes(candidateStart, 30);
    }

    dayCursor = addDays(dayCursor, 1);
  }

  return slots;
}
