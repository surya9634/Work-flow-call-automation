// AI Call Assistant - Twilio + Groq
// Deployable on Render with environment variables

const express = require("express");
const bodyParser = require("body-parser");
const { twiml } = require("twilio");
const axios = require("axios");

// --- Use environment variables ---
const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const twilioNumber = process.env.TWILIO_PHONE_NUMBER;
const groqApiKey = process.env.GROQ_API_KEY;

const client = require("twilio")(accountSid, authToken);
const app = express();
app.use(bodyParser.urlencoded({ extended: false }));

// Memory for conversations
const sessions = {};

// --- Groq AI ---
async function getAIResponse(prompt) {
  try {
    const res = await axios.post(
      "https://api.groq.com/openai/v1/chat/completions",
      {
        model: "llama3-70b-8192",
        messages: [
          { role: "system", content: "You are a helpful AI phone assistant." },
          { role: "user", content: prompt },
        ],
      },
      {
        headers: {
          Authorization: `Bearer ${groqApiKey}`,
          "Content-Type": "application/json",
        },
      }
    );
    return res.data.choices[0].message.content;
  } catch (err) {
    console.error("Groq API error:", err.response?.data || err.message);
    return "Sorry, I could not process that.";
  }
}

// --- Inbound call handler ---
app.post("/voice", (req, res) => {
  const callSid = req.body.CallSid;
  if (!sessions[callSid]) sessions[callSid] = [];

  const response = new twiml.VoiceResponse();
  const gather = response.gather({
    input: "speech",
    action: "/process_speech",
    method: "POST",
  });

  gather.say("Hello! I am your AI assistant. How can I help you?");
  res.type("text/xml");
  res.send(response.toString());
});

// --- Speech processing ---
app.post("/process_speech", async (req, res) => {
  const callSid = req.body.CallSid;
  const userSpeech = req.body.SpeechResult || "No speech detected";

  sessions[callSid].push({ role: "user", content: userSpeech });
  const aiResponse = await getAIResponse(userSpeech);
  sessions[callSid].push({ role: "assistant", content: aiResponse });

  const response = new twiml.VoiceResponse();
  const gather = response.gather({
    input: "speech",
    action: "/process_speech",
    method: "POST",
  });

  gather.say(aiResponse);
  res.type("text/xml");
  res.send(response.toString());
});

// --- Outbound call ---
app.get("/call", async (req, res) => {
  try {
    const toNumber = req.query.to;
    const call = await client.calls.create({
      url: `https://${req.headers.host}/voice`, // Auto detect Render domain
      to: toNumber,
      from: twilioNumber,
    });
    res.json({ success: true, sid: call.sid });
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

// --- Render Port ---
const PORT = process.env.PORT || 3000;
app.listen(PORT, () =>
  console.log(`🚀 AI Call Assistant running on port ${PORT}`)
);
