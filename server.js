import express from "express";
import twilio from "twilio";
import gTTS from "google-tts-api";
import dotenv from "dotenv";

dotenv.config();
const app = express();
const PORT = process.env.PORT || 3000;

const client = twilio(process.env.TWILIO_SID, process.env.TWILIO_AUTH);

// ✅ Big Hindi essay
const hindiEssay = `
भारत एक महान देश है। यहाँ की संस्कृति, परंपरा और विविधता दुनिया भर में प्रसिद्ध है। 
हमारे देश में अनेक भाषाएँ, धर्म और जातियाँ हैं, लेकिन इसके बावजूद यहाँ एकता बनी रहती है। 
भारत की गंगा-जमुनी तहज़ीब पूरे विश्व के लिए प्रेरणा है। 
हमारे स्वतंत्रता सेनानियों ने अपने बलिदान से हमें स्वतंत्रता दिलाई। 
`;

// Function to generate Google TTS audio URL (Hindi)
async function generateHindiSpeech(text) {
  const url = gTTS.getAudioUrl(text, {
    lang: "hi",
    slow: false,
    host: "https://translate.google.com",
  });
  return url;
}

// Route: Make a call with Hindi essay
app.get("/make-call", async (req, res) => {
  try {
    const to = req.query.to;
    if (!to) {
      return res.status(400).send("❌ Missing 'to' phone number");
    }

    // Generate Hindi TTS audio for essay
    const audioUrl = await generateHindiSpeech(hindiEssay);

    // Make the Twilio call
    const call = await client.calls.create({
      url: `${process.env.BASE_URL}/twiml?audioUrl=${encodeURIComponent(audioUrl)}`,
      to,
      from: process.env.TWILIO_NUMBER,
    });

    res.send(`✅ Call started with SID: ${call.sid}`);
  } catch (error) {
    console.error("❌ Error making call:", error);
    res.status(500).send("❌ Error making call: " + error.message);
  }
});

// TwiML endpoint
app.get("/twiml", (req, res) => {
  const audioUrl = req.query.audioUrl;
  const twiml = new twilio.twiml.VoiceResponse();
  twiml.play(audioUrl);

  res.type("text/xml");
  res.send(twiml.toString());
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});

