import pytest
import requests
import os
import time

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')


class TestInterviewAPI:
    """Interview API endpoint tests"""

    def test_root(self):
        response = requests.get(f"{BASE_URL}/api/")
        assert response.status_code == 200
        data = response.json()
        assert "message" in data

    def test_start_interview_missing_body(self):
        response = requests.post(f"{BASE_URL}/api/interview/start", json={})
        assert response.status_code == 422

    def test_start_interview_empty_title(self):
        response = requests.post(f"{BASE_URL}/api/interview/start", json={"job_title": ""}, stream=True)
        # Should either error or stream
        # Collect first chunk
        content = b""
        for chunk in response.iter_content(chunk_size=512):
            content += chunk
            break
        # Could be 200 with error data or 422
        assert response.status_code in [200, 422]

    def test_start_interview_streams(self):
        """Start interview and verify SSE streaming response"""
        response = requests.post(
            f"{BASE_URL}/api/interview/start",
            json={"job_title": "Junior Developer"},
            stream=True,
            timeout=30
        )
        assert response.status_code == 200
        assert "text/event-stream" in response.headers.get("Content-Type", "")

        tokens = []
        session_id = None
        for chunk in response.iter_lines():
            if not chunk:
                continue
            line = chunk.decode("utf-8") if isinstance(chunk, bytes) else chunk
            if line.startswith("data: "):
                import json
                try:
                    data = json.loads(line[6:])
                    if "token" in data:
                        tokens.append(data["token"])
                    if "done" in data and data["done"]:
                        session_id = data.get("session_id")
                        break
                except Exception:
                    pass

        assert len(tokens) > 0, "No tokens received from stream"
        full_text = "".join(tokens).lower()
        assert "yourself" in full_text, f"Expected 'Tell me about yourself' but got: {full_text[:200]}"
        assert session_id is not None, "No session_id returned"
        return session_id

    def test_chat_invalid_session(self):
        response = requests.post(
            f"{BASE_URL}/api/interview/chat",
            json={"session_id": "nonexistent-session-123", "user_message": "Hello"},
            stream=True
        )
        assert response.status_code == 200
        # Check for error in stream
        content = b""
        for chunk in response.iter_content(chunk_size=1024):
            content += chunk
            break
        # Should contain error in response

    def test_full_interview_flow(self):
        """Full integration: start + 6 chat turns to trigger final evaluation"""
        import json

        # Start interview
        resp = requests.post(
            f"{BASE_URL}/api/interview/start",
            json={"job_title": "Software Engineer"},
            stream=True, timeout=30
        )
        assert resp.status_code == 200

        session_id = None
        for chunk in resp.iter_lines():
            line = chunk.decode("utf-8") if isinstance(chunk, bytes) else chunk
            if line.startswith("data: "):
                try:
                    data = json.loads(line[6:])
                    if data.get("done"):
                        session_id = data.get("session_id")
                        break
                except Exception:
                    pass

        assert session_id is not None, "No session_id from start"

        # Do 6 chat turns
        answers = [
            "I have 3 years of Python experience and enjoy problem solving.",
            "I worked on a REST API project using FastAPI and MongoDB.",
            "I led a team of 3 developers to deliver the project on time.",
            "I improved API response time by 40% through caching.",
            "My greatest challenge was migrating a legacy system to microservices.",
            "I plan to learn more about distributed systems and cloud architecture.",
        ]

        last_data = None
        for i, answer in enumerate(answers):
            r = requests.post(
                f"{BASE_URL}/api/interview/chat",
                json={"session_id": session_id, "user_message": answer},
                stream=True, timeout=60
            )
            assert r.status_code == 200, f"Turn {i+1} failed with {r.status_code}"
            for chunk in r.iter_lines():
                line = chunk.decode("utf-8") if isinstance(chunk, bytes) else chunk
                if line.startswith("data: "):
                    try:
                        data = json.loads(line[6:])
                        if data.get("done"):
                            last_data = data
                            break
                    except Exception:
                        pass
            # Small pause between turns
            time.sleep(0.5)

        # After 6 turns, should be complete
        assert last_data is not None, "No done signal from last turn"
        assert last_data.get("is_complete") is True, f"Expected is_complete=True, got: {last_data}"
        assert last_data.get("question_count") == 6, f"Expected question_count=6, got: {last_data}"

    def test_get_session(self):
        """Test get session endpoint"""
        # Start a new session first
        import json
        resp = requests.post(
            f"{BASE_URL}/api/interview/start",
            json={"job_title": "Data Analyst"},
            stream=True, timeout=30
        )
        session_id = None
        for chunk in resp.iter_lines():
            line = chunk.decode("utf-8") if isinstance(chunk, bytes) else chunk
            if line.startswith("data: "):
                try:
                    data = json.loads(line[6:])
                    if data.get("done"):
                        session_id = data.get("session_id")
                        break
                except Exception:
                    pass

        assert session_id is not None
        r = requests.get(f"{BASE_URL}/api/interview/{session_id}")
        assert r.status_code == 200
        data = r.json()
        assert data["session_id"] == session_id
        assert data["job_title"] == "Data Analyst"
        assert "_id" not in data  # MongoDB _id should be excluded

    def test_get_session_not_found(self):
        r = requests.get(f"{BASE_URL}/api/interview/nonexistent-id-xyz")
        assert r.status_code == 200
        data = r.json()
        assert "error" in data
