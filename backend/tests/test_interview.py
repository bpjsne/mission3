import pytest
import requests
import os
import time
import json
from typing import Optional

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')


def _collect_sse_stream(response: requests.Response, timeout_chunks: int = 200) -> tuple[list[str], Optional[dict]]:
    """
    Helper: collect SSE tokens and done payload from a streaming response.
    Returns (tokens, done_data).
    """
    tokens: list[str] = []
    done_data: Optional[dict] = None

    for chunk in response.iter_lines():
        line = chunk.decode("utf-8") if isinstance(chunk, bytes) else chunk
        if not line.startswith("data: "):
            continue
        try:
            data = json.loads(line[6:])
            if "token" in data:
                tokens.append(data["token"])
            if data.get("done"):
                done_data = data
                break
        except Exception:
            pass

    return tokens, done_data


class TestInterviewAPI:
    """Interview API endpoint tests."""

    def test_root(self) -> None:
        response = requests.get(f"{BASE_URL}/api/")
        assert response.status_code == 200
        data = response.json()
        assert "message" in data

    def test_start_interview_missing_body(self) -> None:
        response = requests.post(f"{BASE_URL}/api/interview/start", json={})
        assert response.status_code == 422

    def test_start_interview_empty_title_returns_error(self) -> None:
        """Empty job title should return a 400 HTTP error."""
        response = requests.post(
            f"{BASE_URL}/api/interview/start",
            json={"job_title": ""},
        )
        assert response.status_code == 400

    def test_start_interview_streams_opening_question(self) -> None:
        """Start interview and verify SSE streaming returns 'Tell me about yourself'."""
        response = requests.post(
            f"{BASE_URL}/api/interview/start",
            json={"job_title": "Junior Developer"},
            stream=True,
            timeout=30,
        )
        assert response.status_code == 200
        assert "text/event-stream" in response.headers.get("Content-Type", "")

        tokens, done_data = _collect_sse_stream(response)

        assert len(tokens) > 0, "No tokens received from stream"
        full_text = "".join(tokens).lower()
        assert "yourself" in full_text, f"Expected 'Tell me about yourself' but got: {full_text[:200]}"
        assert done_data is not None, "No done event received"
        assert done_data.get("session_id") is not None, "No session_id in done event"

    def test_start_interview_returns_session_id(self) -> None:
        """Verify the done event contains a valid UUID-format session_id."""
        response = requests.post(
            f"{BASE_URL}/api/interview/start",
            json={"job_title": "Product Manager"},
            stream=True,
            timeout=30,
        )
        assert response.status_code == 200
        _, done_data = _collect_sse_stream(response)
        assert done_data is not None
        session_id = done_data.get("session_id")
        assert isinstance(session_id, str) and len(session_id) > 10

    def test_chat_invalid_session_returns_error(self) -> None:
        """Chat with a non-existent session_id should return HTTP 404."""
        response = requests.post(
            f"{BASE_URL}/api/interview/chat",
            json={"session_id": "nonexistent-session-abc", "user_message": "Hello"},
        )
        assert response.status_code == 404

    def test_chat_first_turn_streams_follow_up(self) -> None:
        """After starting an interview, first user answer should stream a follow-up question."""
        # Start session
        start_resp = requests.post(
            f"{BASE_URL}/api/interview/start",
            json={"job_title": "Data Analyst"},
            stream=True,
            timeout=30,
        )
        _, start_done = _collect_sse_stream(start_resp)
        assert start_done is not None
        session_id = start_done["session_id"]

        # Send first answer
        chat_resp = requests.post(
            f"{BASE_URL}/api/interview/chat",
            json={"session_id": session_id, "user_message": "I have 2 years in data analysis."},
            stream=True,
            timeout=30,
        )
        assert chat_resp.status_code == 200
        tokens, done_data = _collect_sse_stream(chat_resp)
        assert len(tokens) > 0, "No tokens from first chat turn"
        assert done_data is not None
        assert done_data.get("question_count") == 1
        assert done_data.get("is_complete") == False  # noqa: E712 — not yet complete

    def test_six_turns_triggers_final_evaluation(self) -> None:
        """After exactly 6 user answers, is_complete must be True."""
        # Start interview
        start_resp = requests.post(
            f"{BASE_URL}/api/interview/start",
            json={"job_title": "Software Engineer"},
            stream=True,
            timeout=30,
        )
        _, start_done = _collect_sse_stream(start_resp)
        assert start_done is not None, "No session_id from start"
        session_id = start_done["session_id"]

        answers = [
            "I have 3 years of Python experience and enjoy problem solving.",
            "I worked on a REST API project using FastAPI and MongoDB.",
            "I led a team of 3 developers to deliver the project on time.",
            "I improved API response time by 40% through caching.",
            "My greatest challenge was migrating a legacy system to microservices.",
            "I plan to learn more about distributed systems and cloud architecture.",
        ]

        last_done: Optional[dict] = None
        for i, answer in enumerate(answers):
            r = requests.post(
                f"{BASE_URL}/api/interview/chat",
                json={"session_id": session_id, "user_message": answer},
                stream=True,
                timeout=60,
            )
            assert r.status_code == 200, f"Turn {i + 1} failed with {r.status_code}"
            _, done = _collect_sse_stream(r)
            if done:
                last_done = done
            time.sleep(0.5)

        assert last_done is not None, "No done signal from last turn"
        assert last_done.get("is_complete") == True, f"Expected is_complete=True, got: {last_done}"  # noqa: E712
        assert last_done.get("question_count") == 6, f"Expected question_count=6, got: {last_done}"

    def test_completed_session_rejects_further_messages(self) -> None:
        """A completed session should reject additional chat messages with 400."""
        # Start and complete a session (6 turns)
        start_resp = requests.post(
            f"{BASE_URL}/api/interview/start",
            json={"job_title": "QA Engineer"},
            stream=True,
            timeout=30,
        )
        _, start_done = _collect_sse_stream(start_resp)
        assert start_done is not None
        session_id = start_done["session_id"]

        for answer in ["a", "b", "c", "d", "e", "f"]:
            r = requests.post(
                f"{BASE_URL}/api/interview/chat",
                json={"session_id": session_id, "user_message": answer},
                stream=True,
                timeout=60,
            )
            _collect_sse_stream(r)  # drain
            time.sleep(0.3)

        extra = requests.post(
            f"{BASE_URL}/api/interview/chat",
            json={"session_id": session_id, "user_message": "one more"},
        )
        assert extra.status_code == 400

    def test_get_session_returns_correct_data(self) -> None:
        """GET /interview/{session_id} returns session with correct fields, no _id."""
        start_resp = requests.post(
            f"{BASE_URL}/api/interview/start",
            json={"job_title": "DevOps Engineer"},
            stream=True,
            timeout=30,
        )
        _, start_done = _collect_sse_stream(start_resp)
        assert start_done is not None
        session_id = start_done["session_id"]

        r = requests.get(f"{BASE_URL}/api/interview/{session_id}")
        assert r.status_code == 200
        data = r.json()
        assert data["session_id"] == session_id
        assert data["job_title"] == "DevOps Engineer"
        assert "_id" not in data

    def test_get_session_not_found(self) -> None:
        r = requests.get(f"{BASE_URL}/api/interview/nonexistent-id-xyz")
        assert r.status_code == 404
