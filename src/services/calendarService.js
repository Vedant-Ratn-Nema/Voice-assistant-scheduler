import { google } from "googleapis";
import { readFileSync } from "fs";
import { addDays, formatISO, startOfDay } from "date-fns";
import { config, hasGoogleCalendar } from "../config.js";

function getCalendarConfigError() {
  if (!config.calendarId) return "Missing GOOGLE_CALENDAR_ID.";
  if (!config.serviceAccountJson && !config.serviceAccountFile) {
    return "Missing GOOGLE_SERVICE_ACCOUNT_JSON or GOOGLE_SERVICE_ACCOUNT_FILE.";
  }
  return "";
}

function loadServiceAccountCredentials() {
  if (config.serviceAccountJson) {
    return JSON.parse(config.serviceAccountJson);
  }
  if (config.serviceAccountFile) {
    const fileContent = readFileSync(config.serviceAccountFile, "utf8");
    return JSON.parse(fileContent);
  }
  throw new Error("Service account credentials are not configured.");
}

function getCalendarClient() {
  if (!hasGoogleCalendar) {
    return { calendar: null, error: getCalendarConfigError() || "Google Calendar is not configured." };
  }

  try {
    const parsed = loadServiceAccountCredentials();
    const auth = new google.auth.GoogleAuth({
      credentials: parsed,
      scopes: ["https://www.googleapis.com/auth/calendar"],
    });

    return {
      calendar: google.calendar({ version: "v3", auth }),
      error: null,
    };
  } catch {
    return {
      calendar: null,
      error:
        "Invalid Google service account credentials. Use GOOGLE_SERVICE_ACCOUNT_FILE (preferred) or a valid single-line GOOGLE_SERVICE_ACCOUNT_JSON value.",
    };
  }
}

export async function getBusyIntervals(startISO, endISO) {
  const { calendar } = getCalendarClient();
  if (!calendar) return [];

  const response = await calendar.freebusy.query({
    requestBody: {
      timeMin: startISO,
      timeMax: endISO,
      timeZone: config.timezone,
      items: [{ id: config.calendarId }],
    },
  });

  const busy = response.data.calendars?.[config.calendarId]?.busy || [];
  return busy.map((entry) => ({
    start: entry.start,
    end: entry.end,
  }));
}

export async function listEvents(startISO, endISO, queryText = "") {
  const { calendar } = getCalendarClient();
  if (!calendar) return [];

  const response = await calendar.events.list({
    calendarId: config.calendarId,
    timeMin: startISO,
    timeMax: endISO,
    singleEvents: true,
    orderBy: "startTime",
    q: queryText || undefined,
    maxResults: 50,
  });

  return (response.data.items || []).map((event) => ({
    id: event.id,
    summary: event.summary || "",
    start: event.start?.dateTime || event.start?.date,
    end: event.end?.dateTime || event.end?.date,
  }));
}

export async function findEventByName(name, lookAheadDays = 60) {
  const startISO = formatISO(new Date());
  const endISO = formatISO(addDays(startOfDay(new Date()), lookAheadDays));
  const events = await listEvents(startISO, endISO, name);

  return events.find((event) =>
    event.summary.toLowerCase().includes(name.toLowerCase()),
  );
}

export async function createCalendarEvent({ title, startISO, endISO, attendees = [] }) {
  const { calendar, error } = getCalendarClient();
  if (!calendar) {
    return { created: false, reason: error || "Google Calendar is not configured." };
  }

  const response = await calendar.events.insert({
    calendarId: config.calendarId,
    requestBody: {
      summary: title || "Scheduled meeting",
      start: {
        dateTime: startISO,
        timeZone: config.timezone,
      },
      end: {
        dateTime: endISO,
        timeZone: config.timezone,
      },
      attendees: attendees.map((email) => ({ email })),
    },
  });

  return {
    created: true,
    eventId: response.data.id,
    htmlLink: response.data.htmlLink,
  };
}
