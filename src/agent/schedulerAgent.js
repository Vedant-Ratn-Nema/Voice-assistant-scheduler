import OpenAI from "openai";
import { addMinutes, format, parseISO } from "date-fns";
import { config, hasOpenAi } from "../config.js";
import {
  createCalendarEvent,
  findEventByName,
  getBusyIntervals,
} from "../services/calendarService.js";
import { findAvailableSlots } from "../utils/slotFinder.js";
import { extractConstraintsFromText } from "../utils/timeParser.js";

const client = hasOpenAi ? new OpenAI({ apiKey: config.openAiApiKey }) : null;

const sessions = new Map();

function getSession(sessionId) {
  if (!sessions.has(sessionId)) {
    sessions.set(sessionId, {
      constraints: {
        durationMinutes: null,
        dayPart: null,
        preferredDays: [],
        avoidDays: [],
        windowStartISO: null,
        windowEndISO: null,
      },
      lastSuggestedSlots: [],
      title: "Sync Meeting",
    });
  }
  return sessions.get(sessionId);
}

function mergeConstraints(existing, patch) {
  return {
    ...existing,
    ...Object.fromEntries(
      Object.entries(patch).filter(([, value]) => {
        if (value === null || value === undefined) return false;
        if (Array.isArray(value) && value.length === 0) return false;
        return true;
      }),
    ),
    preferredDays: patch.preferredDays?.length ? patch.preferredDays : existing.preferredDays,
    avoidDays: patch.avoidDays?.length ? patch.avoidDays : existing.avoidDays,
  };
}

async function generateClarifyingQuestion(state, userText) {
  if (!hasOpenAi) {
    if (!state.constraints.durationMinutes) return "How long should the meeting be?";
    return "Do you have a preferred day or time window?";
  }

  const systemPrompt = `
You are a scheduling assistant.
Ask one concise follow-up question to gather missing information for booking a meeting.
Keep responses to 1-2 sentences and conversational.
`;

  const completion = await client.chat.completions.create({
    model: "gpt-4o-mini",
    temperature: 0.2,
    messages: [
      { role: "system", content: systemPrompt },
      {
        role: "user",
        content: JSON.stringify({
          userText,
          constraints: state.constraints,
          missing: {
            durationMissing: !state.constraints.durationMinutes,
            windowMissing: !state.constraints.windowStartISO && !state.constraints.dayPart,
          },
        }),
      },
    ],
  });

  return completion.choices[0]?.message?.content?.trim() || "What time should we target?";
}

function matchSlotFromUserText(userText, slots) {
  if (!slots.length) return null;
  const lower = userText.toLowerCase();
  const normalized = lower.replace(/\s+/g, " ").trim();
  const direct = slots.find((slot) => lower.includes(slot.label.toLowerCase()));
  if (direct) return direct;

  // Match shorter natural references like "book 12.30 pm"
  const byLooseLabel = slots.find((slot) => {
    const slotDate = parseISO(slot.startISO);
    const variants = [
      format(slotDate, "h:mm a"),
      format(slotDate, "h.mm a"),
      format(slotDate, "h:mma"),
      format(slotDate, "h a"),
      format(slotDate, "ha"),
    ].map((value) => value.toLowerCase());
    return variants.some((variant) => normalized.includes(variant));
  });
  if (byLooseLabel) return byLooseLabel;

  if (/first|1st|earlier|earliest/i.test(userText)) return slots[0];
  if (/second|2nd/i.test(userText) && slots[1]) return slots[1];
  if (/third|3rd/i.test(userText) && slots[2]) return slots[2];
  if (/last/i.test(userText)) return slots[slots.length - 1];

  const timeMatch = userText.match(/(\d{1,2})(?:[:.\s](\d{2}))?\s*(am|pm)\b/i);
  if (timeMatch) {
    const rawHour = Number(timeMatch[1]);
    const minute = Number(timeMatch[2] || "0");
    const meridiem = timeMatch[3].toLowerCase();
    let hour24 = rawHour % 12;
    if (meridiem === "pm") hour24 += 12;

    const candidates = slots.filter((slot) => {
      const slotDate = parseISO(slot.startISO);
      return slotDate.getHours() === hour24 && slotDate.getMinutes() === minute;
    });
    if (candidates.length === 1) return candidates[0];
    if (candidates.length > 1) return candidates[0];
  }

  const parsed = new Date(userText);
  if (!Number.isNaN(parsed.getTime())) {
    return slots.find((slot) => {
      const slotDate = parseISO(slot.startISO);
      return (
        slotDate.getHours() === parsed.getHours() &&
        slotDate.getMinutes() === parsed.getMinutes()
      );
    });
  }
  return null;
}

function hasEnoughInfo(constraints) {
  return Boolean(constraints.durationMinutes && (constraints.windowStartISO || constraints.dayPart || constraints.preferredDays.length));
}

function buildFallbackAlternatives(constraints) {
  const updated = { ...constraints };
  if (updated.dayPart === "afternoon") updated.dayPart = "morning";
  else if (updated.dayPart === "morning") updated.dayPart = "afternoon";
  else updated.dayPart = "any";

  if (updated.windowStartISO && updated.windowEndISO) {
    const start = parseISO(updated.windowStartISO);
    const end = parseISO(updated.windowEndISO);
    updated.windowStartISO = addMinutes(start, 24 * 60).toISOString();
    updated.windowEndISO = addMinutes(end, 24 * 60).toISOString();
  }

  return updated;
}

function slotListToText(slots) {
  return slots.map((slot, index) => `${index + 1}. ${slot.label}`).join("\n");
}

export async function handleSchedulerTurn({ sessionId, userText }) {
  const state = getSession(sessionId);
  const parsedPatch = await extractConstraintsFromText(userText, findEventByName);
  state.constraints = mergeConstraints(state.constraints, parsedPatch);

  const chosenSlot = matchSlotFromUserText(userText, state.lastSuggestedSlots);
  if (chosenSlot) {
    const titleMatch = userText.match(/(?:title|called|subject)\s+["']?([^"']+)["']?/i);
    if (titleMatch) {
      state.title = titleMatch[1];
    }
    const created = await createCalendarEvent({
      title: state.title,
      startISO: chosenSlot.startISO,
      endISO: chosenSlot.endISO,
    });
    if (created.created) {
      return {
        message: `Booked. I scheduled "${state.title}" for ${format(parseISO(chosenSlot.startISO), "EEEE h:mm a")}.`,
        state,
        debug: { created },
      };
    }
    return {
      message: `I found your slot, but I could not create the event yet: ${created.reason}.`,
      state,
    };
  }

  if (!hasEnoughInfo(state.constraints)) {
    const question = await generateClarifyingQuestion(state, userText);
    return { message: question, state };
  }

  const searchStart = state.constraints.windowStartISO || new Date().toISOString();
  const searchEnd = state.constraints.windowEndISO || addMinutes(new Date(), 14 * 24 * 60).toISOString();
  const busyIntervals = await getBusyIntervals(searchStart, searchEnd);
  let slots = findAvailableSlots({
    constraints: state.constraints,
    busyIntervals,
    timezone: config.timezone,
  });

  if (!slots.length) {
    const fallback = buildFallbackAlternatives(state.constraints);
    slots = findAvailableSlots({
      constraints: fallback,
      busyIntervals,
      timezone: config.timezone,
    });
    if (!slots.length) {
      return {
        message:
          "I couldn’t find a free slot in that window. Would you like me to check a wider range, like the next 7 days?",
        state,
      };
    }

    state.lastSuggestedSlots = slots;
    return {
      message: `That window is fully booked. I found alternatives:\n${slotListToText(slots)}\nWhich one works best?`,
      state,
    };
  }

  state.lastSuggestedSlots = slots;
  return {
    message: `I found these options:\n${slotListToText(slots)}\nTell me which one you want, and I’ll book it.`,
    state,
  };
}
