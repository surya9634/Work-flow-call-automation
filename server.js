import express from "express";
import multer from "multer";
import fs from "fs";
import { Readable } from "stream";
import vosk from "vosk";
import edgeTTS from "edge-tts";

const app = express();
const upload = multer({ dest: "uploads/" });
const PORT = process.env.PORT || 3000;

app.use(express.static("public"));

// ---- Setup VOSK (STT) ----
const MODEL_PATH = "models/vosk-model-small-en-us-0.15";
if (!fs.existsSync(MODEL_PATH)) {
  console.error("❌ Vosk model missing! Download from: https://alphacephei.com/vosk/models");
  process.exit();
}
vosk.setLogLevel(0);
const model = new vosk.Model(MODEL_PATH);

// 🎤 Speech-to-Text route
app.post("/stt", upload.single("audio"), async (req, res) => {
  const rec = new vosk.Recognizer({ model: model, sampleRate: 16000 });
  const data = fs.readFileSync(req.file.path);
  rec.acceptWaveform(data);
  const text = rec.finalResult().text;
  rec.free();
  fs.unlinkSync(req.file.path); // cleanup
  res.json({ text });
});

// 🔊 Text-to-Speech route
app.get("/tts", async (req, res) => {
  const text = req.query.text || "Hello from Edge TTS!";
  const stream = await edgeTTS.synthesize(text, { voice: "en-US-JennyNeural" });

  res.setHeader("Content-Type", "audio/mpeg");
  Readable.from(stream.stream).pipe(res);
});

// 🚀 Start Server
app.listen(PORT, () => console.log(`✅ Server running on http://localhost:${PORT}`));
