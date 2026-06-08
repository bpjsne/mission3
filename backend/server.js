require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { MongoClient } = require('mongodb');
const Anthropic = require('@anthropic-ai/sdk');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = process.env.PORT || 8002;

// ── Anthropic client (authenticates via process.env.ANTHROPIC_API_KEY) ──
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ── MongoDB ──
const mongoClient = new MongoClient(process.env.MONGO_URL);
let db;

async function connectDB() {
  await mongoClient.connect();
  db = mongoClient.db(process.env.DB_NAME);
  console.log('MongoDB connected');
}

app.use(cors());
app.use(express.json());

// ── Constants ──
const CLAUDE_MODEL = 'claude-sonnet-4-6';
const MIN_QUESTIONS_FOR_EVALUATION = 6;

function getSystemMessage(jobTitle) {
  return `You are a professional, experienced job interviewer conducting a mock interview for the position of "${jobTitle}".

INTERVIEW PROTOCOL:
1. When you receive "START_INTERVIEW", respond ONLY with exactly: "Tell me about yourself."
2. For each subsequent candidate response, ask ONE focused follow-up question based on what they actually said. The question must be relevant to a ${jobTitle} role.
3. Your questions must be DYNAMIC — genuinely tailored to the candidate's answers, NOT pre-scripted.
4. Naturally cover topic areas: relevant skills, past experience, problem-solving, teamwork, achievements, challenges, career goals.
5. When you receive a message starting with "[FINAL_EVALUATION]", provide a comprehensive interview evaluation.

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

Keep responses professional and concise. Ask only ONE question at a time. Do not number your questions.`;
}

// ── SSE helpers ──
function initSSE(res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'X-Accel-Buffering': 'no',
    'Connection': 'keep-alive',
  });
}

function sendSSE(res, data) {
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

// ── POST /api/interview/start ──
app.post('/api/interview/start', async (req, res) => {
  try {
    const { job_title } = req.body;
    if (!job_title || !job_title.trim()) {
      return res.status(400).json({ error: 'Job title is required' });
    }

    const sessionId = uuidv4();
    const triggerMsg = { role: 'user', content: 'START_INTERVIEW' };

    await db.collection('interview_sessions').insertOne({
      session_id: sessionId,
      job_title: job_title.trim(),
      question_count: 0,
      is_complete: false,
      messages: [triggerMsg],
      created_at: new Date().toISOString(),
    });

    initSSE(res);

    let fullResponse = '';
    const stream = anthropic.messages.stream({
      model: CLAUDE_MODEL,
      max_tokens: 1024,
      system: getSystemMessage(job_title.trim()),
      messages: [triggerMsg],
    });

    stream.on('text', (text) => {
      fullResponse += text;
      sendSSE(res, { token: text });
    });

    await stream.finalMessage();

    await db.collection('interview_sessions').updateOne(
      { session_id: sessionId },
      { $push: { messages: { role: 'assistant', content: fullResponse } } }
    );

    sendSSE(res, { done: true, session_id: sessionId });
    res.end();
  } catch (err) {
    console.error('Error in /api/interview/start:', err.message);
    if (!res.headersSent) {
      res.status(500).json({ error: err.message });
    } else {
      sendSSE(res, { error: err.message });
      res.end();
    }
  }
});

// ── POST /api/interview/chat ──
app.post('/api/interview/chat', async (req, res) => {
  try {
    const { session_id, user_message } = req.body;

    const session = await db.collection('interview_sessions').findOne(
      { session_id },
      { projection: { _id: 0 } }
    );

    if (!session) return res.status(404).json({ error: 'Session not found' });
    if (session.is_complete) return res.status(400).json({ error: 'Interview already complete' });

    const questionCount = session.question_count + 1;
    const isFinal = questionCount >= MIN_QUESTIONS_FOR_EVALUATION;

    const userContent = isFinal
      ? `[FINAL_EVALUATION]\n\nCandidate's final answer: ${user_message}`
      : user_message;

    const newUserMsg = { role: 'user', content: userContent };
    const messagesForAPI = [...session.messages, newUserMsg];

    await db.collection('interview_sessions').updateOne(
      { session_id },
      {
        $push: { messages: newUserMsg },
        $set: { question_count: questionCount },
      }
    );

    initSSE(res);

    let fullResponse = '';
    const stream = anthropic.messages.stream({
      model: CLAUDE_MODEL,
      max_tokens: 2048,
      system: getSystemMessage(session.job_title),
      messages: messagesForAPI,
    });

    stream.on('text', (text) => {
      fullResponse += text;
      sendSSE(res, { token: text });
    });

    await stream.finalMessage();

    const aiUpdate = { $push: { messages: { role: 'assistant', content: fullResponse } } };
    if (isFinal) aiUpdate.$set = { is_complete: true };
    await db.collection('interview_sessions').updateOne({ session_id }, aiUpdate);

    sendSSE(res, { done: true, is_complete: isFinal, question_count: questionCount });
    res.end();
  } catch (err) {
    console.error('Error in /api/interview/chat:', err.message);
    if (!res.headersSent) {
      res.status(500).json({ error: err.message });
    } else {
      sendSSE(res, { error: err.message });
      res.end();
    }
  }
});

// ── GET /api/interview/:sessionId ──
app.get('/api/interview/:sessionId', async (req, res) => {
  try {
    const session = await db.collection('interview_sessions').findOne(
      { session_id: req.params.sessionId },
      { projection: { _id: 0 } }
    );
    if (!session) return res.status(404).json({ error: 'Session not found' });
    res.json(session);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/ (health check) ──
app.get('/api/', (req, res) => {
  res.json({ message: 'AI Mock Interviewer API (Node.js)', status: 'ok' });
});

// ── Start ──
connectDB().then(() => {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Node.js server listening on port ${PORT}`);
  });
}).catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
