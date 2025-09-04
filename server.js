import express from "express";
import twilio from "twilio";
import fs from "fs";
import dotenv from "dotenv";

// ✅ Correct import for msedge-tts
import pkg from "msedge-tts";
const { TTS } = pkg;

dotenv.config();

const app = express();
const port = process.env.PORT || 5000;

// Twilio setup
const accountSid = process.env.TWILIO_SID;
const authToken = process.env.TWILIO_AUTH;
const fromNumber = process.env.TWILIO_NUMBER;
const client = twilio(accountSid, authToken);

// Endpoint to make call
app.get("/make-call", async (req, res) => {
  const { to, text, voice } = req.query;
  if (!to || !text) {
    return res.status(400).send("Missing 'to' or 'text' query params");
  }

  try {
    // ✅ Create TTS engine
    const tts = new TTS();
    const chosenVoice = voice || "en-US-JennyNeural"; // Default if not passed

    const audioStream = tts.toStream(text, { voice: chosenVoice });
    const chunks = [];

    for await (const chunk of audioStream) {
      chunks.push(chunk);
    }

    fs.writeFileSync("speech.mp3", Buffer.concat(chunks));

    // Start Twilio call
    const call = await client.calls.create({
      url: `${process.env.BASE_URL}/voice`,
      to,
      from: fromNumber,
    });

    res.json({ message: "Call started!", callSid: call.sid });
  } catch (err) {
    console.error("❌ Error making call:", err);
    res.status(500).send("Error making call");
  }
});

// Twilio webhook to play speech
app.post("/voice", (req, res) => {
  res.type("text/xml");
  res.send(`
    <Response>
      <Play>${process.env.BASE_URL}/speech.mp3</Play>
    </Response>
  `);
});

// Serve generated MP3
app.get("/speech.mp3", (req, res) => {
  res.sendFile(process.cwd() + "/speech.mp3");
});

app.listen(port, () => console.log(`🚀 Server running on port ${port}`));
