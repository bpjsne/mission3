from fastapi import FastAPI, APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
import json
from pathlib import Path
from pydantic import BaseModel, Field
from typing import List, AsyncGenerator
import uuid
from datetime import datetime, timezone
from emergentintegrations.llm.chat import LlmChat, UserMessage, TextDelta, StreamDone

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

app = FastAPI()
api_router = APIRouter(prefix="/api")

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

ANTHROPIC_API_KEY: str = os.environ.get('ANTHROPIC_API_KEY', '')
CLAUDE_MODEL = "claude-sonnet-4-6"
MIN_QUESTIONS_FOR_EVALUATION = 6


def get_system_message(job_title: str) -> str:
    return f"""You are a professional, experienced job interviewer conducting a mock interview for the position of "{job_title}".

INTERVIEW PROTOCOL:
1. When you receive "START_INTERVIEW", respond ONLY with exactly: "Tell me about yourself."
2. For each subsequent candidate response, ask ONE focused follow-up question based on what they actually said. The question must be relevant to a {job_title} role.
3. Your questions must be DYNAMIC — genuinely tailored to the candidate's answers, NOT pre-scripted.
4. Naturally cover topic areas such as: relevant skills, past experience, problem-solving, teamwork, achievements, challenges, and career goals.
5. When you receive a message starting with "[FINAL_EVALUATION]", provide a comprehensive interview evaluation using the format below.

EVALUATION FORMAT (only when triggered by [FINAL_EVALUATION]):
**Interview Performance Evaluation**

**Overall Performance:** [1-2 sentence summary]

**Key Strengths:**
- [Specific strength with reference to something they said]
- [Another strength]
- [Another strength]

**Areas for Improvement:**
- [Specific, actionable area]
- [Another area]

**Tips for Better Interview Performance:**
1. [Concrete, actionable tip]
2. [Another tip]
3. [Another tip]

**Closing:** [Brief encouraging and honest closing remark]

Keep responses professional and concise. Ask only ONE question at a time. Do not number your questions."""


def _build_chat(session_id: str, job_title: str) -> LlmChat:
    """Create a configured LlmChat instance for the given session."""
    return (
        LlmChat(
            api_key=ANTHROPIC_API_KEY,
            session_id=session_id,
            system_message=get_system_message(job_title),
        ).with_model("anthropic", CLAUDE_MODEL)
    )


class InterviewSession(BaseModel):
    session_id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    job_title: str
    question_count: int = 0
    is_complete: bool = False
    messages: List[dict] = Field(default_factory=list)
    created_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())


class StartInterviewRequest(BaseModel):
    job_title: str


class ChatRequest(BaseModel):
    session_id: str
    user_message: str


async def _stream_opening(session_id: str, job_title: str) -> AsyncGenerator[str, None]:
    """Stream Claude's opening question ('Tell me about yourself') as SSE events."""
    try:
        chat = _build_chat(session_id, job_title)
        full_response = ""
        async for event in chat.stream_message(UserMessage(text="START_INTERVIEW")):
            if isinstance(event, TextDelta):
                full_response += event.content
                yield f"data: {json.dumps({'token': event.content})}\n\n"
            elif isinstance(event, StreamDone):
                await db.interview_sessions.update_one(
                    {"session_id": session_id},
                    {"$push": {"messages": {"role": "ai", "content": full_response}}}
                )
                yield f"data: {json.dumps({'done': True, 'session_id': session_id})}\n\n"
                break
    except Exception as e:
        logger.error("Error in _stream_opening: %s", e)
        yield f"data: {json.dumps({'error': str(e)})}\n\n"


async def _stream_chat_response(
    session_id: str,
    job_title: str,
    user_msg_text: str,
    is_final: bool,
    question_count: int,
) -> AsyncGenerator[str, None]:
    """Stream Claude's follow-up question or final evaluation as SSE events."""
    try:
        chat = _build_chat(session_id, job_title)
        full_response = ""
        async for event in chat.stream_message(UserMessage(text=user_msg_text)):
            if isinstance(event, TextDelta):
                full_response += event.content
                yield f"data: {json.dumps({'token': event.content})}\n\n"
            elif isinstance(event, StreamDone):
                update_data: dict = {
                    "$push": {"messages": {"role": "ai", "content": full_response}}
                }
                if is_final:
                    update_data["$set"] = {"is_complete": True}
                await db.interview_sessions.update_one(
                    {"session_id": session_id},
                    update_data
                )
                yield f"data: {json.dumps({'done': True, 'is_complete': is_final, 'question_count': question_count})}\n\n"
                break
    except Exception as e:
        logger.error("Error in _stream_chat_response: %s", e)
        yield f"data: {json.dumps({'error': str(e)})}\n\n"


def _sse_response(generator: AsyncGenerator[str, None]) -> StreamingResponse:
    return StreamingResponse(
        generator,
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@api_router.post("/interview/start")
async def start_interview(request: StartInterviewRequest) -> StreamingResponse:
    if not request.job_title.strip():
        raise HTTPException(status_code=400, detail="Job title is required")

    session = InterviewSession(job_title=request.job_title.strip())
    await db.interview_sessions.insert_one(session.model_dump())
    return _sse_response(_stream_opening(session.session_id, session.job_title))


@api_router.post("/interview/chat")
async def interview_chat(request: ChatRequest) -> StreamingResponse:
    session = await db.interview_sessions.find_one(
        {"session_id": request.session_id}, {"_id": 0}
    )
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    if session.get("is_complete"):
        raise HTTPException(status_code=400, detail="Interview already complete")

    question_count: int = session.get("question_count", 0) + 1
    await db.interview_sessions.update_one(
        {"session_id": request.session_id},
        {
            "$push": {"messages": {"role": "user", "content": request.user_message}},
            "$set": {"question_count": question_count},
        },
    )

    is_final = question_count >= MIN_QUESTIONS_FOR_EVALUATION
    user_msg_text = (
        f"[FINAL_EVALUATION]\n\nCandidate's final answer: {request.user_message}"
        if is_final
        else request.user_message
    )

    return _sse_response(
        _stream_chat_response(
            session_id=request.session_id,
            job_title=session["job_title"],
            user_msg_text=user_msg_text,
            is_final=is_final,
            question_count=question_count,
        )
    )


@api_router.get("/interview/{session_id}")
async def get_session(session_id: str) -> dict:
    session = await db.interview_sessions.find_one(
        {"session_id": session_id}, {"_id": 0}
    )
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    return session


@api_router.get("/")
async def root() -> dict:
    return {"message": "AI Mock Interviewer API"}


app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get('CORS_ORIGINS', '*').split(','),
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("shutdown")
async def shutdown_db_client() -> None:
    client.close()
