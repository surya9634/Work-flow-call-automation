import express from "express";
import fs from "fs";
import edgeTTS from "edge-tts";
import twilio from "twilio";

const app = express();
const port = process.env.PORT || 3000;

// ✅ Load ENV variables
const BASE_URL = process.env.BASE_URL;
const TWILIO_AUTH = process.env.TWILIO_AUTH;
const TWILIO_NUMBER = process.env.TWILIO_NUMBER;
const TWILIO_SID = process.env.TWILIO_SID;

// ✅ Twilio client
const client = twilio(TWILIO_SID, TWILIO_AUTH);

// ✅ Function to generate speech using edge-tts
async function generateSpeech(text, filePath) {
  try {
    const stream = await edgeTTS.stream({
      text,
      voice: "en-US-AriaNeural", // you can change the voice
    });

    const writeStream = fs.createWriteStream(filePath);
    for await (const chunk of stream) {
      if (chunk.type === "audio") {
        writeStream.write(chunk.data);
      }
    }
    writeStream.end();
    return filePath;
  } catch (err) {
    console.error("❌ Error generating speech:", err);
    throw err;
  }
}

// ✅ Route to make call
app.get("/make-call", async (req, res) => {
  try {
    const { to, text } = req.query;

    if (!to || !text) {
      return res.status(400).send("Missing 'to' or 'text' parameter");
    }

    const audioFile = "./speech.mp3";
    await generateSpeech(text, audioFile);

    // ✅ URL of audio file served from our server
    const audioUrl = `${BASE_URL}/speech.mp3`;

    // ✅ Make Twilio call
    const call = await client.calls.create({
      url: `${BASE_URL}/twiml?audio=${encodeURIComponent(audioUrl)}`,
      to,
      from: TWILIO_NUMBER,
    });

    res.json({ success: true, callSid: call.sid });
  } catch (err) {
    console.error("❌ Error making call:", err);
    res.status(500).send("Error making call: " + err.message);
  }
});

// ✅ Serve audio file
app.get("/speech.mp3", (req, res) => {
  res.sendFile("speech.mp3", { root: "." });
});

// ✅ TwiML for Twilio to play audio
app.get("/twiml", (req, res) => {
  const { audio } = req.query;
  res.type("text/xml");
  res.send(`
    <Response>
      <Play>${audio}</Play>
    </Response>
  `);
});

app.listen(port, () => {
  console.log(`🚀 Server running at http://localhost:${port}`);
});
