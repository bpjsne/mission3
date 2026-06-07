import React, { useState, useEffect, useRef, useCallback } from "react";
import { Send, RotateCcw, Briefcase, Bot, ChevronRight, Loader2, AlertCircle, Trophy } from "lucide-react";
import "./App.css";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

// ─── Message Bubble ───────────────────────────────────────────────────────────
const Message = ({ message }) => {
  const isAI = message.role === "ai";
  const lines = message.content.split("\n");

  return (
    <div
      className={`flex gap-3 message-enter ${isAI ? "" : "flex-row-reverse"}`}
      data-testid={isAI ? "chat-message-ai" : "chat-message-user"}
    >
      {isAI && (
        <div className="w-8 h-8 rounded-full bg-blue-600 flex items-center justify-center flex-shrink-0 mt-1 shadow-lg shadow-blue-600/20">
          <Bot size={15} className="text-white" />
        </div>
      )}
      <div
        className={`max-w-[80%] rounded-lg px-4 py-3 ${
          isAI
            ? "bg-white/5 border border-white/10 text-white"
            : "bg-blue-600 text-white shadow-lg shadow-blue-600/20"
        }`}
      >
        <p
          className={`text-[11px] uppercase tracking-[0.15em] font-medium mb-2 ${
            isAI ? "text-[#A1A1AA]" : "text-blue-200"
          }`}
        >
          {isAI ? "Interviewer" : "You"}
        </p>
        <div className="text-sm leading-relaxed">
          {lines.map((line, i) => {
            const isBold = line.startsWith("**") && line.endsWith("**") && line.length > 4;
            const content = isBold ? line.slice(2, -2) : line;
            return (
              <p key={i} className={`${isBold ? "font-semibold text-white mt-3 mb-1" : ""} ${line === "" ? "h-2" : ""}`}>
                {content}
              </p>
            );
          })}
          {message.streaming && (
            <span className="inline-block w-1.5 h-4 bg-white/60 ml-0.5 cursor-blink align-middle" />
          )}
        </div>
      </div>
    </div>
  );
};

// ─── Progress Bar ─────────────────────────────────────────────────────────────
const ProgressBar = ({ questionCount, isComplete }) => {
  const MAX = 6;
  const progress = Math.min((questionCount / MAX) * 100, 100);

  return (
    <div className="px-6 py-3 border-b border-white/10 flex items-center gap-4 bg-black/20">
      <span className="text-[11px] text-[#A1A1AA] uppercase tracking-widest whitespace-nowrap">
        {isComplete ? "Interview Complete" : `Question ${questionCount + 1} of ${MAX}`}
      </span>
      <div className="flex-1 h-px bg-white/10 rounded-full overflow-hidden">
        <div
          className="h-full bg-blue-600 transition-all duration-700 rounded-full"
          style={{ width: `${progress}%` }}
        />
      </div>
      <span className="text-[11px] text-[#A1A1AA] whitespace-nowrap">{Math.round(progress)}%</span>
    </div>
  );
};

// ─── Main App ─────────────────────────────────────────────────────────────────
function App() {
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
  const messagesRef = useRef(messages);
  messagesRef.current = messages;

  const scrollToBottom = useCallback(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  // Stream handler — adds a streaming placeholder and fills it in real-time
  const handleStream = useCallback(async (url, body, onDone) => {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!response.ok || !response.body) {
      throw new Error("Failed to connect to interview service");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    const streamId = `stream-${Date.now()}`;

    setMessages((prev) => [
      ...prev,
      { id: streamId, role: "ai", content: "", streaming: true },
    ]);

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
              setError(data.error);
              setMessages((prev) => prev.filter((m) => m.id !== streamId));
            }
          } catch {
            // ignore malformed JSON
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }, []);

  const handleStart = async () => {
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
          setTimeout(() => inputRef.current?.focus(), 100);
        }
      );
    } catch (e) {
      setError(e.message || "Failed to start interview");
      setPhase("setup");
    }
  };

  const handleSubmit = async () => {
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
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleReset = () => {
    setPhase("setup");
    setJobTitle("");
    setJobTitleInput("");
    setSessionId(null);
    setMessages([]);
    setUserInput("");
    setIsLoading(false);
    setQuestionCount(0);
    setError(null);
  };

  return (
    <div className="min-h-screen bg-[#0A0A0A] text-white flex flex-col font-body">
      {/* Background texture */}
      <div
        className="fixed inset-0 pointer-events-none bg-cover bg-center"
        style={{
          backgroundImage:
            "url(https://images.unsplash.com/photo-1710438399422-2fca27686bcd?crop=entropy&cs=srgb&fm=jpg&q=85)",
          opacity: 0.04,
        }}
      />

      {/* ── Header ── */}
      <header className="sticky top-0 z-50 bg-black/60 backdrop-blur-xl border-b border-white/10">
        <div className="max-w-4xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-md bg-blue-600 flex items-center justify-center shadow-lg shadow-blue-600/30">
              <Bot size={15} className="text-white" />
            </div>
            <div>
              <h1 className="text-base font-semibold tracking-tight text-white leading-none">
                AI Mock Interviewer
              </h1>
              {jobTitle && (
                <p className="text-[11px] text-[#A1A1AA] mt-0.5">{jobTitle}</p>
              )}
            </div>
          </div>

          {phase !== "setup" && (
            <button
              onClick={handleReset}
              data-testid="reset-button"
              className="flex items-center gap-2 text-xs text-[#A1A1AA] hover:text-white border border-white/20 hover:border-white/40 px-3 py-2 rounded-md transition-all duration-200"
            >
              <RotateCcw size={13} />
              New Interview
            </button>
          )}
        </div>
      </header>

      {/* ── Main Content ── */}
      <main className="flex-1 flex flex-col max-w-4xl mx-auto w-full relative overflow-hidden">

        {/* ── SETUP SCREEN ── */}
        {phase === "setup" && (
          <div className="flex-1 flex items-center justify-center p-6">
            <div className="w-full max-w-md animate-fade-in">
              <div className="text-center mb-8">
                <div className="w-16 h-16 rounded-full bg-blue-600/15 border border-blue-600/30 flex items-center justify-center mx-auto mb-5">
                  <Briefcase size={26} className="text-blue-500" />
                </div>
                <h2 className="text-2xl font-semibold text-white mb-2 tracking-tight">
                  Ready to practice?
                </h2>
                <p className="text-[#A1A1AA] text-sm">
                  Enter the job title you want to interview for
                </p>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="text-[11px] uppercase tracking-[0.2em] text-[#A1A1AA] block mb-2">
                    Job Title
                  </label>
                  <input
                    data-testid="job-title-input"
                    type="text"
                    value={jobTitleInput}
                    onChange={(e) => setJobTitleInput(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleStart()}
                    placeholder="e.g. Junior Developer, Data Analyst..."
                    className="w-full bg-[#121212] border border-white/20 rounded-md px-4 py-3 text-white placeholder-[#555] focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all duration-200"
                    autoFocus
                  />
                </div>

                <button
                  data-testid="start-button"
                  onClick={handleStart}
                  disabled={!jobTitleInput.trim()}
                  className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed text-white font-medium py-3 px-6 rounded-md transition-all duration-200 hover:-translate-y-0.5 flex items-center justify-center gap-2 shadow-lg shadow-blue-600/20"
                >
                  Start Interview
                  <ChevronRight size={17} />
                </button>

                {error && (
                  <div className="flex items-center gap-2 bg-red-500/10 border border-red-500/30 rounded-md p-3 text-red-400 text-xs">
                    <AlertCircle size={14} />
                    {error}
                  </div>
                )}
              </div>

              <p className="text-center text-xs text-[#555] mt-6">
                6+ dynamic questions · Real-time AI feedback · Performance evaluation
              </p>
            </div>
          </div>
        )}

        {/* ── INTERVIEW SCREEN ── */}
        {(phase === "interview" || phase === "complete") && (
          <div className="flex-1 flex flex-col min-h-0">
            <ProgressBar questionCount={questionCount} isComplete={phase === "complete"} />

            {/* Chat Messages */}
            <div className="flex-1 overflow-y-auto p-6 space-y-5 min-h-0">
              {messages.length === 0 && (
                <div className="flex items-center justify-center h-full">
                  <div className="flex items-center gap-2 text-[#A1A1AA] text-sm">
                    <Loader2 size={16} className="animate-spin" />
                    Starting your interview...
                  </div>
                </div>
              )}

              {messages.map((msg) => (
                <Message key={msg.id} message={msg} />
              ))}

              {/* Typing indicator — only while loading and last message is from user */}
              {isLoading && messages[messages.length - 1]?.role === "user" && (
                <div className="flex gap-3 message-enter">
                  <div className="w-8 h-8 rounded-full bg-blue-600 flex items-center justify-center flex-shrink-0">
                    <Bot size={15} className="text-white" />
                  </div>
                  <div className="bg-white/5 border border-white/10 rounded-lg px-4 py-3">
                    <div className="flex gap-1 items-center h-5">
                      <span className="w-2 h-2 bg-[#A1A1AA] rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
                      <span className="w-2 h-2 bg-[#A1A1AA] rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
                      <span className="w-2 h-2 bg-[#A1A1AA] rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
                    </div>
                  </div>
                </div>
              )}

              {error && (
                <div className="flex items-center gap-2 bg-red-500/10 border border-red-500/30 rounded-md p-3 text-red-400 text-sm">
                  <AlertCircle size={15} />
                  {error}
                </div>
              )}

              <div ref={chatEndRef} />
            </div>

            {/* ── INPUT AREA (during interview) ── */}
            {phase === "interview" && (
              <div className="border-t border-white/10 p-4 bg-black/30 backdrop-blur-sm">
                <div className="flex gap-3 items-end">
                  <textarea
                    ref={inputRef}
                    data-testid="chat-input"
                    value={userInput}
                    onChange={(e) => setUserInput(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder="Type your answer... (Enter to submit · Shift+Enter for new line)"
                    disabled={isLoading}
                    rows={2}
                    className="flex-1 bg-[#121212] border border-white/20 rounded-md px-4 py-3 text-white placeholder-[#555] focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all duration-200 resize-none disabled:opacity-40 text-sm"
                  />
                  <button
                    data-testid="submit-message-button"
                    onClick={handleSubmit}
                    disabled={!userInput.trim() || isLoading}
                    className="bg-blue-600 hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed text-white p-3 rounded-md transition-all duration-200 hover:-translate-y-0.5 flex-shrink-0 shadow-lg shadow-blue-600/20"
                  >
                    {isLoading ? (
                      <Loader2 size={20} className="animate-spin" />
                    ) : (
                      <Send size={20} />
                    )}
                  </button>
                </div>
              </div>
            )}

            {/* ── COMPLETION BANNER ── */}
            {phase === "complete" && (
              <div
                data-testid="feedback-panel"
                className="border-t border-white/10 p-5 bg-black/30 backdrop-blur-sm"
              >
                <div className="bg-blue-600/10 border border-blue-600/30 rounded-md p-4 flex flex-col sm:flex-row items-center gap-4">
                  <div className="flex items-center gap-3 flex-1">
                    <div className="w-9 h-9 rounded-full bg-blue-600/20 border border-blue-500/30 flex items-center justify-center flex-shrink-0">
                      <Trophy size={16} className="text-blue-400" />
                    </div>
                    <div>
                      <p className="text-blue-300 font-medium text-sm">Interview Complete!</p>
                      <p className="text-[#A1A1AA] text-xs mt-0.5">
                        Review the evaluation above, then start a new session.
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={handleReset}
                    data-testid="new-interview-button"
                    className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium py-2 px-5 rounded-md transition-all duration-200 hover:-translate-y-0.5 whitespace-nowrap"
                  >
                    Start New Interview
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}

export default App;
