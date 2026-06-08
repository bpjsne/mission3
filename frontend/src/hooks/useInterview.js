import { useState, useRef, useEffect } from "react";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

export const MAX_QUESTIONS = 6;
const FOCUS_DELAY_MS = 100;

/**
 * Parses a Server-Sent Events ReadableStream into message state updates.
 * Extracted to keep handleStream focused and independently testable.
 */
async function parseSSEStream(response, streamId, setMessages, setError, onDone) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        try {
          const data = JSON.parse(line.slice(6));
          if (data.token) {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === streamId ? { ...m, content: m.content + data.token } : m
              )
            );
          } else if (data.done) {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === streamId ? { ...m, streaming: false } : m
              )
            );
            onDone(data);
          } else if (data.error) {
            const msg = typeof data.error === 'string' && data.error.includes('401')
              ? 'AI service authentication failed — please check the API key.'
              : (typeof data.error === 'string' ? data.error : 'An error occurred. Please try again.');
            setError(msg);
            setMessages((prev) => prev.filter((m) => m.id !== streamId));
          }
        } catch (parseError) {
          console.error("Failed to parse SSE data:", parseError);
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

/**
 * Custom hook encapsulating all interview state and logic.
 * Keeps App.js as a pure presentation layer.
 */
export function useInterview() {
  const [phase, setPhase] = useState("setup");
  const [jobTitle, setJobTitle] = useState("");
  const [jobTitleInput, setJobTitleInput] = useState("");
  const [sessionId, setSessionId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [userInput, setUserInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [questionCount, setQuestionCount] = useState(0);
  const [error, setError] = useState(null);

  const chatEndRef = useRef(null);
  const inputRef = useRef(null);

  // Auto-scroll chat to bottom on new messages
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function handleStream(url, body, onDone) {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!response.ok || !response.body) {
      throw new Error("Failed to connect to interview service");
    }

    const streamId = `stream-${Date.now()}`;
    setMessages((prev) => [
      ...prev,
      { id: streamId, role: "ai", content: "", streaming: true },
    ]);

    await parseSSEStream(response, streamId, setMessages, setError, onDone);
  }

  async function handleStart() {
    const title = jobTitleInput.trim();
    if (!title) return;
    setError(null);
    setJobTitle(title);
    setMessages([]);
    setQuestionCount(0);
    setPhase("interview");

    try {
      await handleStream(
        `${API}/interview/start`,
        { job_title: title },
        (data) => {
          setSessionId(data.session_id);
          setTimeout(() => inputRef.current?.focus(), FOCUS_DELAY_MS);
        }
      );
    } catch (e) {
      setError(e.message || "Failed to start interview");
      setPhase("setup");
    }
  }

  async function handleSubmit() {
    if (!userInput.trim() || isLoading || !sessionId) return;
    const msg = userInput.trim();
    setUserInput("");
    setError(null);
    setIsLoading(true);

    setMessages((prev) => [
      ...prev,
      { id: `user-${Date.now()}`, role: "user", content: msg },
    ]);

    try {
      await handleStream(
        `${API}/interview/chat`,
        { session_id: sessionId, user_message: msg },
        (data) => {
          if (data.question_count !== undefined) setQuestionCount(data.question_count);
          if (data.is_complete) setPhase("complete");
        }
      );
    } catch (e) {
      setError(e.message || "Failed to send message");
    } finally {
      setIsLoading(false);
      setTimeout(() => inputRef.current?.focus(), FOCUS_DELAY_MS);
    }
  }

  function handleKeyDown(e) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  }

  function handleReset() {
    setPhase("setup");
    setJobTitle("");
    setJobTitleInput("");
    setSessionId(null);
    setMessages([]);
    setUserInput("");
    setIsLoading(false);
    setQuestionCount(0);
    setError(null);
  }

  return {
    phase,
    jobTitle,
    jobTitleInput,
    setJobTitleInput,
    messages,
    userInput,
    setUserInput,
    isLoading,
    questionCount,
    error,
    chatEndRef,
    inputRef,
    handleStart,
    handleSubmit,
    handleKeyDown,
    handleReset,
  };
}
