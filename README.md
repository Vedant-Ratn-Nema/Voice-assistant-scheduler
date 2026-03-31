# Smart Scheduler AI Agent

Voice-enabled scheduling assistant that runs a natural multi-turn conversation, parses complex time language, checks Google Calendar availability, suggests alternatives when conflicts happen, and books meetings.

## What this project demonstrates

- Stateful agentic conversation:
  - Keeps context across turns (duration, day/time preferences, exclusions).
  - Asks clarifying questions when required information is missing.
  - Re-runs search when requirements change mid-conversation.
- LLM + tools orchestration:
  - LLM-guided clarifying dialogue (OpenAI).
  - Google Calendar FreeBusy + Events APIs as external tools.
  - Event creation once user selects a slot.
- Voice interaction:
  - Speech-to-Text: browser speech recognition (`SpeechRecognition` / `webkitSpeechRecognition`).
  - Text-to-Speech: browser `speechSynthesis`.
- Advanced scheduling behavior:
  - Conflict resolution with fallback suggestions.
  - Time parsing for relative and ambiguous requests.

## Architecture

- Frontend (`public/`)
  - Chat UI + voice controls.
  - Sends user utterances to backend and reads responses aloud.
- Backend (`src/server.js`)
  - API routes:
    - `POST /api/session` creates a conversation session.
    - `POST /api/chat` processes a scheduling turn.
- Agent (`src/agent/schedulerAgent.js`)
  - Maintains per-session memory in a state map.
  - Merges parsed constraints into conversation context.
  - Decides whether to ask, search, or book.
- Calendar service (`src/services/calendarService.js`)
  - Authenticates Google service account.
  - Reads busy intervals and matching events.
  - Creates calendar events.
- Time parser + slot finder (`src/utils/`)
  - Extracts constraints from natural language.
  - Generates candidate slots and filters by busy blocks.

## Setup (Local)

### 1) Install dependencies

```bash
npm install
```

### 2) Configure environment variables

```bash
cp .env.example .env
```

Fill in:
- `OPENAI_API_KEY`
- `GOOGLE_CALENDAR_ID`
- `GOOGLE_SERVICE_ACCOUNT_FILE` (preferred) or `GOOGLE_SERVICE_ACCOUNT_JSON`

### 3) Enable Google Calendar API

1. In Google Cloud Console, enable **Google Calendar API**.
2. Create a **Service Account**.
3. Generate a JSON key.
4. Share the target calendar with the service account email (at least "Make changes to events").
5. Configure credentials using either:
   - `GOOGLE_SERVICE_ACCOUNT_FILE` with an absolute path to the JSON key file (recommended), or
   - `GOOGLE_SERVICE_ACCOUNT_JSON` as a single-line JSON string.

### 4) Run

```bash
npm run dev
```

Open `http://localhost:3000`.

## Deployment (Vercel)

1. Push this repo to GitHub.
2. Import repo in Vercel.
3. Add environment variables from `.env.example`.
4. Deploy.

This project includes `vercel.json` configured for a Node API deployment.

## Conversation strategy and prompt choices

- The assistant starts broad, then asks minimal follow-ups:
  - Missing duration -> asks for duration.
  - Missing time window/day-part -> asks for date or window.
- Prompt is constrained to concise questions (1-2 sentences) to keep turn latency low and conversational.
- The agent always prefers actionable next steps:
  - If slots found -> presents options.
  - If no slots -> provides alternatives and asks confirmation.
  - If user references a suggested slot -> attempts booking immediately.

## Supported complex parsing scenarios

The parser includes explicit handling for:

- "sometime late next week"
- "find a time on the morning of June 20th"
- "an hour before my 5 PM meeting on Friday"
- "I need to meet for 45 minutes sometime before my flight that leaves on Friday at 6 PM"
- "a day or two after the 'Project Alpha Kick-off' event"
- "last weekday of this month"
- negative constraints like "not on Wednesday" and "not too early"
- dynamic buffer requests like "an hour to decompress after my last meeting"

## Testing script (manual)

Use these as live test prompts in the app:

1. Basic flow:
   - "I need to schedule a meeting."
   - "1 hour."
   - "Tuesday afternoon."
2. Changing requirements:
   - "Find me a 30-minute slot for tomorrow morning."
   - "Actually we need a full hour. Are any still available?"
3. Conflict handling:
   - "Find 1-hour slots Tuesday afternoon."
   - If full, verify alternate suggestions are offered.
4. Relative time:
   - "I need to meet for 45 minutes sometime before my flight that leaves on Friday at 6 PM."
5. Event-referenced logic:
   - "Find a 15-minute chat a day or two after 'Project Alpha Kick-off'."
6. Date logic:
   - "Can we schedule a 1-hour meeting for the last weekday of this month?"

## Latency notes

- Voice STT/TTS is local browser-native for low overhead.
- Backend keeps in-memory session state to reduce repeated reasoning overhead.
- To get closer to sub-800ms in production:
  - Keep model responses short.
  - Use streaming responses.
  - Run in a region close to users.

## Submission checklist

- [ ] Public GitHub repository link
- [ ] README with setup + architecture + design choices
- [ ] 2-3 minute demo video (with clear audio)

## Possible bonus improvements

- Add participant availability merging (multiple calendars).
- Learn "usual sync" duration from historical events.
- Add confidence scores and explicit clarification when parsing ambiguity is high.
- Replace browser STT/TTS with realtime bidirectional API for better cross-browser consistency.
