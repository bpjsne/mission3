import React from "react";
import { useInterview, MAX_QUESTIONS } from "./hooks/useInterview";
import "./App.css";

// ─── Message Bubble ───────────────────────────────────────────────────────────
const Message = ({ message }) => {
  const isAI = message.role === "ai";
  const lines = message.content.split("\n");

  return (
    <div
      className={`message-wrap ${isAI ? "message-wrap--ai" : "message-wrap--user"}`}
      data-testid={isAI ? "chat-message-ai" : "chat-message-user"}
    >
      {isAI && (
        <div className="message-avatar" aria-hidden="true">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 8V4H8"/><rect width="16" height="12" x="4" y="8" rx="2"/>
            <path d="M2 14h2"/><path d="M20 14h2"/><path d="M15 13v2"/><path d="M9 13v2"/>
          </svg>
        </div>
      )}
      <div className={`message-bubble ${isAI ? "message-bubble--ai" : "message-bubble--user"}`}>
        <span className="message-label">{isAI ? "Interviewer" : "You"}</span>
        <div className="message-text">
          {lines.map((line, i) => {
            const isBold = line.startsWith("**") && line.endsWith("**") && line.length > 4;
            const content = isBold ? line.slice(2, -2) : line;
            return (
              <p
                key={`${message.id}-${i}`}
                className={isBold ? "message-bold" : line === "" ? "message-spacer" : ""}
              >
                {content}
              </p>
            );
          })}
          {message.streaming && <span className="cursor-blink" aria-hidden="true" />}
        </div>
      </div>
    </div>
  );
};

// ─── Progress Bar ─────────────────────────────────────────────────────────────
const ProgressBar = ({ questionCount, isComplete }) => {
  const pct = Math.min(((questionCount + 1) / MAX_QUESTIONS) * 100, 100);
  return (
    <div className="progress-bar">
      <span className="progress-text">
        {isComplete ? "Interview Complete" : `Question ${questionCount + 1} of ${MAX_QUESTIONS}`}
      </span>
      <div className="progress-track">
        <div className="progress-fill" style={{ width: `${pct}%` }} />
      </div>
      <span className="progress-pct">{Math.round(pct)}%</span>
    </div>
  );
};

// ─── Typing Indicator ─────────────────────────────────────────────────────────
const TypingIndicator = () => (
  <div className="message-wrap message-wrap--ai">
    <div className="message-avatar" aria-hidden="true">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 8V4H8"/><rect width="16" height="12" x="4" y="8" rx="2"/>
        <path d="M2 14h2"/><path d="M20 14h2"/><path d="M15 13v2"/><path d="M9 13v2"/>
      </svg>
    </div>
    <div className="message-bubble message-bubble--ai">
      <div className="typing-dots">
        <span /><span /><span />
      </div>
    </div>
  </div>
);

// ─── App ──────────────────────────────────────────────────────────────────────
function App() {
  const {
    phase, jobTitle, jobTitleInput, setJobTitleInput,
    messages, userInput, setUserInput, isLoading,
    questionCount, error, chatEndRef, inputRef,
    handleStart, handleSubmit, handleKeyDown, handleReset,
  } = useInterview();

  const showTypingIndicator = isLoading && messages[messages.length - 1]?.role === "user";

  return (
    <div className="app">
      {/* ── Header ── */}
      <header className="app-header">
        <div className="header-inner">
          <div className="header-brand">
            <div className="header-logo" aria-hidden="true">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 8V4H8"/><rect width="16" height="12" x="4" y="8" rx="2"/>
                <path d="M2 14h2"/><path d="M20 14h2"/><path d="M15 13v2"/><path d="M9 13v2"/>
              </svg>
            </div>
            <div>
              <h1 className="header-title">AI Mock Interviewer</h1>
              {jobTitle && <p className="header-subtitle">{jobTitle}</p>}
            </div>
          </div>
          {phase !== "setup" && (
            <button className="btn-reset" onClick={handleReset} data-testid="reset-button">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/>
                <path d="M3 3v5h5"/>
              </svg>
              New Interview
            </button>
          )}
        </div>
      </header>

      {/* ── Main ── */}
      <main className="app-main">

        {/* ── Setup Screen ── */}
        {phase === "setup" && (
          <div className="setup-screen">
            <div className="setup-card">
              <div className="setup-icon">
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <rect width="20" height="14" x="2" y="7" rx="2" ry="2"/>
                  <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/>
                </svg>
              </div>
              <h2 className="setup-title">Ready to practice?</h2>
              <p className="setup-subtitle">Enter the job title you want to interview for</p>

              <div className="setup-form">
                <label className="form-label" htmlFor="job-title-input">Job Title</label>
                <input
                  id="job-title-input"
                  data-testid="job-title-input"
                  type="text"
                  className="form-input"
                  value={jobTitleInput}
                  onChange={(e) => setJobTitleInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleStart()}
                  placeholder="e.g. Junior Developer, Data Analyst..."
                  autoFocus
                />
                <button
                  data-testid="start-button"
                  className="btn-start"
                  onClick={handleStart}
                  disabled={!jobTitleInput.trim()}
                >
                  Start Interview
                  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>
                  </svg>
                </button>
                {error && (
                  <div className="error-msg" data-testid="error-message">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="12" cy="12" r="10"/><line x1="12" x2="12" y1="8" y2="12"/><line x1="12" x2="12.01" y1="16" y2="16"/>
                    </svg>
                    {error}
                  </div>
                )}
              </div>
              <p className="setup-footer">
                {MAX_QUESTIONS}+ dynamic questions · Real-time AI feedback · Performance evaluation
              </p>
            </div>
          </div>
        )}

        {/* ── Interview + Complete Screens ── */}
        {(phase === "interview" || phase === "complete") && (
          <div className="interview-screen">
            <ProgressBar questionCount={questionCount} isComplete={phase === "complete"} />

            {/* Chat Area */}
            <div className="chat-area">
              {messages.length === 0 && (
                <div className="chat-loading">
                  <svg className="spin" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 12a9 9 0 1 1-6.219-8.56"/>
                  </svg>
                  Starting your interview...
                </div>
              )}

              {messages.map((msg) => (
                <Message key={msg.id} message={msg} />
              ))}

              {showTypingIndicator && <TypingIndicator />}

              {error && (
                <div className="error-msg inline-error">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10"/><line x1="12" x2="12" y1="8" y2="12"/><line x1="12" x2="12.01" y1="16" y2="16"/>
                  </svg>
                  {error}
                </div>
              )}
              <div ref={chatEndRef} />
            </div>

            {/* Input Area */}
            {phase === "interview" && (
              <div className="input-area">
                <div className="input-row">
                  <textarea
                    ref={inputRef}
                    data-testid="chat-input"
                    className="chat-textarea"
                    value={userInput}
                    onChange={(e) => setUserInput(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder="Type your answer… (Enter to submit · Shift+Enter for new line)"
                    disabled={isLoading}
                    rows={2}
                  />
                  <button
                    data-testid="submit-message-button"
                    className="btn-submit"
                    onClick={handleSubmit}
                    disabled={!userInput.trim() || isLoading}
                  >
                    {isLoading ? (
                      <svg className="spin" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M21 12a9 9 0 1 1-6.219-8.56"/>
                      </svg>
                    ) : (
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/>
                      </svg>
                    )}
                  </button>
                </div>
              </div>
            )}

            {/* Completion Banner */}
            {phase === "complete" && (
              <div className="completion-banner" data-testid="feedback-panel">
                <div className="completion-content">
                  <div className="completion-icon">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/>
                      <path d="M4 22h16"/><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/>
                      <path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/>
                      <path d="M18 2H6v7a6 6 0 0 0 12 0V2Z"/>
                    </svg>
                  </div>
                  <div>
                    <p className="completion-title">Interview Complete!</p>
                    <p className="completion-subtitle">Review the evaluation above, then start a new session.</p>
                  </div>
                </div>
                <button
                  className="btn-new-interview"
                  onClick={handleReset}
                  data-testid="new-interview-button"
                >
                  Start New Interview
                </button>
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}

export default App;
