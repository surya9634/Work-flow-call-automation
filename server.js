import express from "express";
import twilio from "twilio";
import fs from "fs";
import dotenv from "dotenv";
import { EdgeTTS } from "edge-tts-universal";

dotenv.config();

const app = express();
const port = process.env.PORT || 5000;

const client = twilio(process.env.TWILIO_SID, process.env.TWILIO_AUTH);

// Generates speech using Edge TTS Universal
async function generateSpeech(text, voice = "en-US-EmmaMultilingualNeural") {
  const tts = new EdgeTTS(text, voice);
  const result = await tts.synthesize();
  const buffer = Buffer.from(await result.audio.arrayBuffer());
  fs.writeFileSync("./speech.mp3", buffer);
}

// Trigger call with text-to-speech
app.get("/make-call", async (req, res) => {
  const { to, text, voice } = req.query;
  if (!to || !text) return res.status(400).send("Missing 'to' or 'text'");

  try {
    await generateSpeech(text, voice);
    const call = await client.calls.create({
      url: `${process.env.BASE_URL}/voice`,
      to,
      from: process.env.TWILIO_NUMBER
    });
    res.json({ message: "Call started", sid: call.sid });
  } catch (err) {
    console.error(err);
    res.status(500).send("Error making call: " + err.message);
  }
});

// Twilio webhook
app.post("/voice", (req, res) => {
  res.type("text/xml");
  res.send(`
    <Response>
      <Play>${process.env.BASE_URL}/speech.mp3</Play>
    </Response>
  `);
});

// Serve speech file
app.get("/speech.mp3", (req, res) => {
  res.sendFile("speech.mp3", { root: "." });
});

app.listen(port, () => console.log(`Server running on port ${port}`));
