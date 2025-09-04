let mediaRecorder, audioChunks = [];

async function startRecording() {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  mediaRecorder = new MediaRecorder(stream);
  mediaRecorder.start();

  mediaRecorder.ondataavailable = e => audioChunks.push(e.data);
  mediaRecorder.onstop = async () => {
    const blob = new Blob(audioChunks, { type: "audio/wav" });
    audioChunks = [];
    const formData = new FormData();
    formData.append("audio", blob, "input.wav");

    const res = await fetch("/stt", { method: "POST", body: formData });
    const data = await res.json();
    document.getElementById("result").innerText = "📝 Recognized: " + data.text;
  };

  setTimeout(() => mediaRecorder.stop(), 4000); // 4 sec record
}

async function playTTS() {
  const text = document.getElementById("result").innerText.replace("📝 Recognized: ", "");
  const audio = document.getElementById("ttsAudio");
  audio.src = `/tts?text=${encodeURIComponent(text)}`;
  audio.play();
}
