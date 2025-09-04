import express from "express";
import twilio from "twilio";
import fs from "fs";
import dotenv from "dotenv";
import edgeTTS from "msedge-tts";

dotenv.config();

const app = express();
const port = process.env.PORT || 5000;

// Twilio setup
const accountSid = process.env.TWILIO_SID;
const authToken = process.env.TWILIO_AUTH;
const fromNumber = process.env.TWILIO_NUMBER;
const client = twilio(accountSid, authToken);

// Generate speech and save as MP3
async function generateSpeech(text, voice = "en-US-JennyNeural") {
  const filepath = "./speech.mp3";

  const tts = new edgeTTS.TextToSpeech(text, voice);
  const readable = await tts.toStream();

  const writeStream = fs.createWriteStream(filepath);
  readable.pipe(writeStream);

  return new Promise((resolve, reject) => {
    writeStream.on("finish", () => resolve(filepath));
    writeStream.on("error", reject);
  });
}

// API: make call
app.get("/make-call", async (req, res) => {
  const { to, text, voice } = req.query;
  if (!to || !text) {
    return res.status(400).send("Missing 'to' or 'text'");
  }

  try {
    await generateSpeech(text, voice);

    const call = await client.calls.create({
      url: `${process.env.BASE_URL}/voice`,
      to,
      from: fromNumber,
    });

    res.json({ message: "📞 Call started!", callSid: call.sid });
  } catch (err) {
    console.error("❌ Error making call:", err);
    res.status(500).send("Error making call");
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

// Serve audio
app.get("/speech.mp3", (req, res) => {
  res.sendFile(process.cwd() + "/speech.mp3");
});

app.listen(port, () => console.log(`🚀 Server running on port ${port}`));
