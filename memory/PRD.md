# AI Mock Interviewer — PRD

## Original Problem Statement
Build a "Mock Job Interview" web application for staff being re-trained into new roles. Staff members can practice job interviews for a specific role. AI acts as a professional interviewer, starts with "Tell me about yourself", asks at least 6 dynamic follow-up questions based on answers, and at the end provides constructive critique and improvement tips.

## Architecture

### Backend (FastAPI + Python)
- `POST /api/interview/start` — Creates MongoDB session, streams Claude opening question via SSE
- `POST /api/interview/chat` — Receives user answer, streams Claude response; triggers final evaluation at question 6+
- AI Provider: Anthropic Claude (claude-sonnet-4-6) via `emergentintegrations` library
- API key secured in backend `.env` (never exposed to frontend)

### Frontend (React)
- Single-page app with 3 phases: `setup` → `interview` → `complete`
- Real-time SSE streaming with `fetch` + `ReadableStream`
- Dark modern theme (#0A0A0A background, blue accents)

### Database (MongoDB)
- Collection: `interview_sessions`
- Fields: `session_id`, `job_title`, `messages[]`, `question_count`, `is_complete`, `created_at`

## User Personas
- Insurance department staff being re-trained into new roles
- Job seekers wanting to practice interview skills

## Core Requirements (Static)
1. Job Title free-text input field
2. Scrollable chat display showing Interviewer/Me conversation
3. User response text input with Submit button
4. AI starts with "Tell me about yourself"
5. At least 6 dynamic follow-up questions (not hardcoded)
6. Final constructive critique with improvement tips after 6th answer
7. Anthropic Claude authentication via ANTHROPIC_API_KEY env variable

## Stack Migration to Node.js (Feb 2026)
- ✅ Backend migrated to **Node.js Express** (`/app/backend/server.js`) running on port 8002
- ✅ Python `server.py` acts as transparent reverse-proxy (supervisor constraint: uvicorn on 8001)
- ✅ `@anthropic-ai/sdk` v0.102.0 used for Claude streaming (`process.env.ANTHROPIC_API_KEY`)
- ✅ Conversation history managed in MongoDB + passed to Anthropic API per request
- ✅ Frontend rewritten with **plain CSS** (no Tailwind) — semantic class names in `App.css`
- ✅ `index.css` cleared of all `@tailwind` / `@apply` directives
- ✅ User-friendly error messages for 401 API authentication failures
- ⚠️ ANTHROPIC_API_KEY needs replacement (user's key was auto-revoked after being shared)

## What's Been Implemented (Feb 2026)
- ✅ Full MVP: setup screen, interview flow, 6+ questions, final feedback
- ✅ Real-time SSE streaming (word by word)
- ✅ MongoDB session storage
- ✅ Dark modern UI with progress bar, typing indicator
- ✅ New Interview / Reset functionality
- ✅ All data-testid attributes for testing
- ✅ 100% backend + frontend tests passing

## Code Quality Improvements Applied (Feb 2026)
- ✅ Extracted `useInterview` custom hook (`/src/hooks/useInterview.js`) — resolved all useCallback dep warnings
- ✅ `parseSSEStream` extracted as standalone testable function
- ✅ Removed `useCallback` wrappers (plain async functions, no stale closure risk)
- ✅ Fixed empty catch block → now logs `console.error` with context
- ✅ `MAX_QUESTIONS = 6`, `FOCUS_DELAY_MS = 100`, `QUERY_STALE_TIME_MS = 60_000` named constants
- ✅ Fixed React key in Message component (`${message.id}-line-${i}` instead of bare index)
- ✅ `TypingIndicator` extracted as separate component
- ✅ Backend: extracted `_stream_opening`, `_stream_chat_response`, `_build_chat`, `_sse_response` helpers
- ✅ Backend: full return type hints on all route functions
- ✅ Backend: proper HTTP 400/404 via `HTTPException` instead of JSON 200 error responses
- ✅ Backend: `CLAUDE_MODEL`, `MIN_QUESTIONS_FOR_EVALUATION` named constants
- ✅ Tests: `is True` → `== True`, `is` → `==` for literal comparisons
- ✅ Tests: `_collect_sse_stream` helper extracted to DRY up all tests
- ✅ Tests: `test_full_interview_flow` split into focused independent tests
- ✅ Tests: full type hints added to all test methods
- ✅ `use-toast.js`: fixed `[state]` dep → `[]` (subscribe once on mount, no stale listener accumulation)
- ✅ `index.js`: `60_000` extracted to `QUERY_STALE_TIME_MS`

## Prioritized Backlog

### P0 — Done
- Core interview flow with Claude AI
- SSE streaming responses
- Final evaluation/feedback

### P1 — Next
- Save/replay past interview sessions
- Export evaluation as PDF or text
- Interview tips/coaching during conversation

### P2 — Future
- Multiple AI models support (Gemini, GPT)
- Resume upload for personalized questions
- Industry-specific question banks
- Performance scoring/grading
- Share interview results

## Next Tasks
1. Add session history (list of past interviews) for replay and review
2. PDF export of final evaluation
3. Interview difficulty levels (entry, mid, senior)
