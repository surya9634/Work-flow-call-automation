// server.js — Groq (LLM) + Vosk (STT) + Edge TTS + Twilio Media Streams
import "dotenv/config";
import express from "express";
import bodyParser from "body-parser";
import expressWs from "express-ws";
import fs from "fs";
import path from "path";
import axios from "axios";
import edgeTTS from "edge-tts";
import twilio from "twilio";
import vosk from "vosk";

const {
  TWILIO_ACCOUNT_SID,
  TWILIO_AUTH_TOKEN,
  TWILIO_PHONE_NUMBER,
  PUBLIC_URL, // e.g. https://Work-flow-call-automation.onrender.com
  GROQ_API_KEY
} = process.env;

if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_PHONE_NUMBER || !PUBLIC_URL || !GROQ_API_KEY) {
  console.warn("⚠️ Missing env vars. Check .env.example and Render Environment.");
}

const app = express();
expressWs(app);
app.use(bodyParser.json({ limit: "2mb" }));
app.use(bodyParser.urlencoded({ extended: false }));

// Twilio client
const client = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);

// ---------- Vosk STT setup ----------
const MODEL_PATH = path.join(process.cwd(), "models", "vosk-model-small-en-us-0.15");
if (!fs.existsSync(MODEL_PATH)) {
  console.warn("⚠️ Vosk model folder not found at:", MODEL_PATH);
}
vosk.setLogLevel(0);

let voskModel = null;
try {
  voskModel = new vosk.Model(MODEL_PATH);
  console.log("✅ Vosk model loaded");
} catch (e) {
  console.error("Vosk model load failed:", e.message);
}

// Per-call state
const calls = new Map(); // callSid -> { rec: VoskRecognizer, history: [{role, content}] }

// μ-law -> PCM16 conversion table
const MULAW_DECODE_TABLE = new Int16Array(256);
(function buildMulawTable() {
  // Based on G.711 μ-law
  function mulawDecode(u_val) {
    u_val = ~u_val & 0xff;
    let t = ((u_val & 0x0F) << 3) + 0x84;
    t <<= ((u_val & 0x70) >> 4);
    return ((u_val & 0x80) ? (0x84 - t) : (t - 0x84));
  }
  for (let i = 0; i < 256; i++) {
    MULAW_DECODE_TABLE[i] = mulawDecode(i);
  }
})();
function mulawToPCM16(mulawBuf) {
  const out = new Int16Array(mulawBuf.length);
  for (let i = 0; i < mulawBuf.length; i++) {
    out[i] = MULAW_DECODE_TABLE[mulawBuf[i]];
  }
  return Buffer.from(out.buffer);
}

// ---------- Groq Chat ----------
async function llamaReply(history) {
  // history: [{role: 'system'|'user'|'assistant', content: string}, ...]
  const payload = {
    model: "llama-3.1-8b-instant", // fast & free; upgrade to 70b if needed
    messages: history,
    temperature: 0.4,
    max_tokens: 256
  };
  const resp = await axios.post("https://api.groq.com/openai/v1/chat/completions", payload, {
    headers: {
      "Authorization": `Bearer ${GROQ_API_KEY}`,
      "Content-Type": "application/json"
    },
    timeout: 30000
  });
  return resp.data.choices?.[0]?.message?.content?.trim() || "Sorry, I didn't catch that.";
}

// ---------- Twilio entrypoints ----------

// 1) Inbound call webhook: start media stream
app.post("/voice", (req, res) => {
  const vr = new twilio.twiml.VoiceResponse();

  // Greet once using TTS file shortly after first transcript,
  // so here we immediately connect stream and handle greetings in pipeline.
  const connect = vr.connect();
  connect.stream({ url: `${PUBLIC_URL.replace("https://", "wss://")}/media` });

  res.type("text/xml").send(vr.toString());
});

// 2) WebSocket endpoint for Media Streams (8kHz μ-law)
app.ws("/media", (ws) => {
  let callSid = null;

  ws.on("message", async (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }

    if (msg.event === "start") {
      callSid = msg.start?.callSid;
      console.log("▶️ Stream start", callSid);

      // per-call state
      const rec = (voskModel) ? new vosk.Recognizer({ model: voskModel, sampleRate: 8000 }) : null;
      rec && rec.setMaxAlternatives(0);
      rec && rec.setWords(false);

      calls.set(callSid, {
        rec,
        history: [
          { role: "system", content: "You are a warm, natural, emotionally expressive voice assistant for a business. Be concise, friendly, and helpful. If user asks about booking or lead capture, collect name, phone, and preferred time politely." }
        ]
      });

    } else if (msg.event === "media") {
      // decode 8-bit μ-law -> PCM16 @ 8kHz
      const ulaw = Buffer.from(msg.media.payload, "base64");
      const pcm16 = mulawToPCM16(ulaw);

      const s = calls.get(callSid);
      if (!s || !s.rec) return;
      const final = s.rec.acceptWaveform(pcm16); // returns true when a final result segment is ready

      if (final) {
        const result = s.rec.result(); // { text: "..." }
        const text = (result && result.text || "").trim();
        if (text) {
          console.log(`👂 (${callSid})`, text);
          await handleUtterance(callSid, text);
        }
      } else {
        // You could also use partials if you want barge-in
        // const partial = s.rec.partialResult();
        // console.log("partial:", partial);
      }
    } else if (msg.event === "stop") {
      console.log("⏹️ Stream stop", callSid);
      const s = calls.get(callSid);
      try { s?.rec?.free(); } catch {}
      calls.delete(callSid);
    }
  });

  ws.on("close", () => {
    if (callSid) {
      const s = calls.get(callSid);
      try { s?.rec?.free(); } catch {}
      calls.delete(callSid);
    }
  });
});

// Handle one complete utterance: LLaMA -> Edge TTS -> Redirect call to play -> resume stream
async function handleUtterance(callSid, userText) {
  const s = calls.get(callSid);
  if (!s) return;

  s.history.push({ role: "user", content: userText });

  // 1) Get LLaMA reply (Groq)
  let replyText = "Sorry, I missed that.";
  try {
    replyText = await llamaReply(s.history);
  } catch (e) {
    console.error("Groq error:", e.message);
  }
  s.history.push({ role: "assistant", content: replyText });
  console.log(`🤖 (${callSid})`, replyText);

  // 2) Generate voice with Edge TTS
  const fileName = `tts-${callSid}-${Date.now()}.mp3`;
  const filePath = path.join(process.cwd(), "tts", fileName);
  if (!fs.existsSync(path.dirname(filePath))) fs.mkdirSync(path.dirname(filePath), { recursive: true });

  try {
    // Choose a natural, emotional voice (tweak as you like)
    const VOICE = process.env.EDGE_TTS_VOICE || "en-US-JennyNeural";
    const tts = edgeTTS.synthesize({
      text: replyText,
      voice: VOICE,
      // You can tweak style/prosody with SSML if desired
    });
    const writable = fs.createWriteStream(filePath);
    (await tts).audioStream.pipe(writable);
    await new Promise((resolve) => writable.on("finish", resolve));
  } catch (e) {
    console.error("Edge TTS error:", e.message);
    return;
  }

  // 3) Tell Twilio to play the audio now, then reconnect stream (so conversation continues)
  try {
    const twiml = new twilio.twiml.VoiceResponse();
    twiml.play(`${PUBLIC_URL}/audio/${fileName}`);
    const connect = twiml.connect();
    connect.stream({ url: `${PUBLIC_URL.replace("https://", "wss://")}/media` });

    await client.calls(callSid).update({ twiml: twiml.toString() });
  } catch (e) {
    console.error("Twilio redirect error:", e.message);
  }
}

// Serve generated audio files
app.use("/audio", express.static(path.join(process.cwd(), "tts")));

// Outbound test endpoint (optional)
app.get("/call", async (req, res) => {
  try {
    const to = req.query.to;
    if (!to) return res.status(400).json({ error: "Provide ?to=+E164 number" });
    const call = await client.calls.create({
      to,
      from: TWILIO_PHONE_NUMBER,
      url: `${PUBLIC_URL}/voice`
    });
    res.json({ sid: call.sid });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// Health
app.get("/", (req, res) => res.send("✅ Workflow Call Automation (Groq + Vosk + Edge TTS)"));

// Start
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server listening on ${PORT}`));
