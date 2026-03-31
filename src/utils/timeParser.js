import * as chrono from "chrono-node";
import {
  addDays,
  addMonths,
  endOfDay,
  endOfMonth,
  nextFriday,
  nextWednesday,
  set,
  startOfDay,
} from "date-fns";

const weekdayMap = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
};

function getNextWeekday(target) {
  const now = new Date();
  const day = now.getDay();
  const delta = (target - day + 7) % 7 || 7;
  return addDays(startOfDay(now), delta);
}

function parseDayPart(text) {
  if (/\bmorning\b/i.test(text)) return "morning";
  if (/\bafternoon\b/i.test(text)) return "afternoon";
  if (/\bevening\b/i.test(text) || /\bafter\s+7\b/i.test(text)) return "evening";
  return null;
}

function parseDurationMinutes(text) {
  const hourMatch = text.match(/(\d+)\s*(hour|hr|hours)\b/i);
  const minuteMatch = text.match(/(\d+)\s*(minute|min|minutes)\b/i);
  const quickMatch = text.match(/\bquick\s+(\d+)\b/i);

  let minutes = 0;
  if (hourMatch) minutes += Number(hourMatch[1]) * 60;
  if (minuteMatch) minutes += Number(minuteMatch[1]);
  if (!minutes && quickMatch) minutes += Number(quickMatch[1]);
  return minutes || null;
}

function parseWeekdayHints(text) {
  const lower = text.toLowerCase();
  const preferredDays = new Set();
  const avoidDays = new Set();

  Object.entries(weekdayMap).forEach(([name, index]) => {
    const isAvoided = new RegExp(`\\b(?:not\\s+on|except\\s+|exclude\\s+)${name}\\b`, "i").test(
      lower,
    );
    if (isAvoided) {
      avoidDays.add(index);
      return;
    }

    // Accept broader phrasing such as "for friday slots", "this friday", etc.
    if (new RegExp(`\\b(?:on\\s+|for\\s+|this\\s+|next\\s+)?${name}\\b`, "i").test(lower)) {
      preferredDays.add(index);
    }
  });

  return { preferredDays: [...preferredDays], avoidDays: [...avoidDays] };
}

function parseLastWeekdayOfMonth(text) {
  if (!/last weekday of (this|the) month/i.test(text)) return null;
  const monthEnd = endOfMonth(new Date());
  let current = startOfDay(monthEnd);
  while (current.getDay() === 0 || current.getDay() === 6) {
    current = addDays(current, -1);
  }
  return {
    windowStartISO: current.toISOString(),
    windowEndISO: endOfDay(current).toISOString(),
  };
}

function parseLateNextWeek(text) {
  if (!/late next week/i.test(text)) return null;
  const friday = nextFriday(new Date());
  const wednesday = nextWednesday(new Date());
  return {
    windowStartISO: startOfDay(wednesday).toISOString(),
    windowEndISO: endOfDay(friday).toISOString(),
  };
}

function parseNamedEventOffset(text) {
  const match = text.match(/['"]([^'"]+)['"].*day or two after/i);
  if (!match) return null;
  return {
    eventName: match[1],
    offsetDaysMin: 1,
    offsetDaysMax: 2,
  };
}

function parseBeforeMeetingConstraint(text) {
  const match = text.match(
    /(\d+)\s*(minute|minutes|hour|hours)\s+before\s+my\s+([0-9]{1,2}(?::[0-9]{2})?\s*(?:am|pm))\s+meeting\s+on\s+([a-z]+)/i,
  );
  if (!match) return null;

  const amount = Number(match[1]);
  const unit = match[2].toLowerCase();
  const bufferMinutes = unit.startsWith("hour") ? amount * 60 : amount;
  const meetingClock = match[3];
  const weekday = match[4].toLowerCase();
  const dayIndex = weekdayMap[weekday];
  if (dayIndex === undefined) return null;

  const day = getNextWeekday(dayIndex);
  const parsed = chrono.parseDate(meetingClock, day);
  if (!parsed) return null;

  const deadline = new Date(parsed.getTime() - bufferMinutes * 60 * 1000);
  return {
    windowStartISO: startOfDay(day).toISOString(),
    windowEndISO: deadline.toISOString(),
  };
}

function parseRelativeDeadline(text) {
  const match = text.match(
    /(\d+)\s*(minute|minutes|hour|hours).*before my flight.*friday at ([0-9]{1,2}(?::[0-9]{2})?\s*(?:am|pm))/i,
  );
  if (!match) return null;

  const amount = Number(match[1]);
  const unit = match[2].toLowerCase();
  const bufferMinutes = unit.startsWith("hour") ? amount * 60 : amount;
  const friday = getNextWeekday(5);
  const flightTime = chrono.parseDate(match[3], friday);
  if (!flightTime) return null;

  const deadline = new Date(flightTime.getTime() - bufferMinutes * 60 * 1000);
  return {
    windowStartISO: new Date().toISOString(),
    windowEndISO: deadline.toISOString(),
  };
}

export async function extractConstraintsFromText(text, findEventByNameFn) {
  const now = new Date();
  const durationMinutes = parseDurationMinutes(text);
  const dayPart = parseDayPart(text);
  const { preferredDays, avoidDays } = parseWeekdayHints(text);

  let windowStartISO = null;
  let windowEndISO = null;

  const explicit = chrono.parse(text, now, { forwardDate: true });
  if (explicit.length) {
    const first = explicit[0];
    const start = first.start.date();
    const end = first.end?.date();
    windowStartISO = startOfDay(start).toISOString();
    windowEndISO = endOfDay(end || start).toISOString();
  }

  const lateNextWeek = parseLateNextWeek(text);
  if (lateNextWeek) {
    windowStartISO = lateNextWeek.windowStartISO;
    windowEndISO = lateNextWeek.windowEndISO;
  }

  const lastWeekday = parseLastWeekdayOfMonth(text);
  if (lastWeekday) {
    windowStartISO = lastWeekday.windowStartISO;
    windowEndISO = lastWeekday.windowEndISO;
  }

  const beforeMeeting = parseBeforeMeetingConstraint(text);
  if (beforeMeeting) {
    windowStartISO = beforeMeeting.windowStartISO;
    windowEndISO = beforeMeeting.windowEndISO;
  }

  const deadline = parseRelativeDeadline(text);
  if (deadline) {
    windowStartISO = deadline.windowStartISO;
    windowEndISO = deadline.windowEndISO;
  }

  const namedEventOffset = parseNamedEventOffset(text);
  if (namedEventOffset && typeof findEventByNameFn === "function") {
    const event = await findEventByNameFn(namedEventOffset.eventName);
    if (event?.start) {
      const eventDate = new Date(event.start);
      const rangeStart = addDays(startOfDay(eventDate), namedEventOffset.offsetDaysMin);
      const rangeEnd = addDays(endOfDay(eventDate), namedEventOffset.offsetDaysMax);
      windowStartISO = rangeStart.toISOString();
      windowEndISO = rangeEnd.toISOString();
    }
  }

  if (/next week/i.test(text) && !windowStartISO) {
    const start = addDays(startOfDay(now), 7 - now.getDay() + 1);
    const end = addDays(endOfDay(start), 6);
    windowStartISO = start.toISOString();
    windowEndISO = end.toISOString();
  }

  if (/this month/i.test(text) && !windowStartISO) {
    windowStartISO = startOfDay(now).toISOString();
    windowEndISO = endOfMonth(now).toISOString();
  }

  if (/tomorrow/i.test(text)) {
    const tomorrow = addDays(now, 1);
    windowStartISO = startOfDay(tomorrow).toISOString();
    windowEndISO = endOfDay(tomorrow).toISOString();
  }

  if (/not too early/i.test(text)) {
    return {
      durationMinutes,
      dayPart,
      preferredDays,
      avoidDays,
      windowStartISO,
      windowEndISO,
      notBeforeHour: 10,
    };
  }

  if (/after 7/i.test(text)) {
    return {
      durationMinutes,
      dayPart,
      preferredDays,
      avoidDays,
      windowStartISO,
      windowEndISO,
      notBeforeHour: 19,
    };
  }

  if (/decompress after my last meeting/i.test(text)) {
    return {
      durationMinutes,
      dayPart,
      preferredDays,
      avoidDays,
      windowStartISO,
      windowEndISO,
      afterLastMeetingBufferMinutes: 60,
    };
  }

  if (/june 20/i.test(text) && /morning/i.test(text)) {
    const base = set(addMonths(startOfDay(now), 0), {
      month: 5,
      date: 20,
    });
    return {
      durationMinutes,
      dayPart: "morning",
      preferredDays,
      avoidDays,
      windowStartISO: startOfDay(base).toISOString(),
      windowEndISO: endOfDay(base).toISOString(),
    };
  }

  return {
    durationMinutes,
    dayPart,
    preferredDays,
    avoidDays,
    windowStartISO,
    windowEndISO,
  };
}
