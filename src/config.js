import dotenv from "dotenv";

dotenv.config();

export const config = {
  port: Number(process.env.PORT || 3000),
  timezone: process.env.DEFAULT_TIMEZONE || "America/Los_Angeles",
  openAiApiKey: process.env.OPENAI_API_KEY || "",
  calendarId: process.env.GOOGLE_CALENDAR_ID || "",
  serviceAccountJson: process.env.GOOGLE_SERVICE_ACCOUNT_JSON || "",
  serviceAccountFile: process.env.GOOGLE_SERVICE_ACCOUNT_FILE || "",
};

export const hasOpenAi = Boolean(config.openAiApiKey);
export const hasGoogleCalendar = Boolean(
  config.calendarId && (config.serviceAccountJson || config.serviceAccountFile),
);
