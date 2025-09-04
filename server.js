import express from "express";
import twilio from "twilio";
import fs from "fs";
import dotenv from "dotenv";
import { tts } from "msedge-tts";

dotenv.config();

const app = express();
const port = process.env.PORT || 5000;

// Twilio setup
const accountSid = process.env.TWILIO_SID;
const authToken = process.env.TWILIO_AUTH;
const fromNumber = process.env.TWILIO_NUMBER;
const client = twilio(accountSid, authToken);

// Start a call with custom text
app.get("/make-call", async (req, res) => {
  const { to, text } = req.query;
  if (!to || !text) {
    return res.status(400).send("Missing 'to' or 'text' query params");
  }

  try {
    // Generate speech.mp3 using msedge-tts
    const audioBuffer = await tts({
      text,
      voice: "en-US-JennyNeural" // You can change to other voices
    });
    fs.writeFileSync("speech.mp3", audioBuffer);

    // Create a Twilio call
    const call = await client.calls.create({
      url: `${process.env.BASE_URL}/voice`,
      to,
      from: fromNumber,
    });

    res.json({ message: "Call started!", callSid: call.sid });
  } catch (err) {
    console.error(err);
    res.status(500).send("Error making call");
  }
});

// Twilio webhook: tells Twilio to play our audio
app.post("/voice", (req, res) => {
  res.type("text/xml");
  res.send(`
    <Response>
      <Play>${process.env.BASE_URL}/speech.mp3</Play>
    </Response>
  `);
});

// Serve generated speech.mp3
app.get("/speech.mp3", (req, res) => {
  res.sendFile(process.cwd() + "/speech.mp3");
});

app.listen(port, () => console.log(`🚀 Server running on port ${port}`));
