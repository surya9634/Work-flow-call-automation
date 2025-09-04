import express from "express";
import twilio from "twilio";
import fs from "fs";
import edgeTTS from "edge-tts";

const app = express();
const port = process.env.PORT || 5000;

// Twilio credentials from env vars
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
    // Generate speech.mp3 from input text
    const outputFile = "speech.mp3";
    const tts = await edgeTTS.synthesize(text, {
      voice: "en-US-JennyNeural",
      outputFile,
    });
    fs.writeFileSync(outputFile, Buffer.from(await tts.toBuffer()));

    // Create call
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

// Twilio webhook when call connects
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
