const video = document.getElementById('videoElement');
const predictionElement = document.getElementById('prediction');
const recognizedTextElement = document.getElementById('recognizedText');
const clearButton = document.getElementById('clearButton');
const flipButton = document.getElementById('flipButton');
const colorButton = document.getElementById('colorButton');
const speakButton = document.getElementById('speakButton');
const canvas = document.createElement('canvas');
const context = canvas.getContext('2d');
const interval = 100;

let isFlipped = true;
const colors = ['#ffffffff', '#000000ff'];
let currentColorIndex = 0;
let lastRecognizedText = "";

// --- Audio Control ---
let audioCtx;
let isAudioInitialized = false;
let synthesisVoices = [];

// --- Speech Synthesis Voice Loading ---
// This function populates the voice list and is critical for speech to work.
function loadVoices() {
    synthesisVoices = window.speechSynthesis.getVoices();
    if (synthesisVoices.length > 0) {
        console.log("Speech synthesis voices successfully loaded:", synthesisVoices);
    } else {
        console.warn("Speech synthesis voice list is empty. Speech might not work.");
    }
}

// The voiceschanged event is the correct place to load voices.
window.speechSynthesis.onvoiceschanged = loadVoices;

function initAudio() {
    if (isAudioInitialized) return;
    try {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        if (audioCtx.state === 'suspended') {
            audioCtx.resume();
        }
        isAudioInitialized = true;
        console.log("Audio context initialized successfully by user interaction.");

        // Also explicitly load voices here, as some browsers might need this.
        loadVoices();

    } catch (e) {
        console.error("Failed to initialize AudioContext:", e);
    }
}

document.body.addEventListener('click', initAudio, { once: true });
document.body.addEventListener('touchstart', initAudio, { once: true });

function playBeep() {
    if (!isAudioInitialized) return;
    try {
        const oscillator = audioCtx.createOscillator();
        const gainNode = audioCtx.createGain();
        oscillator.connect(gainNode);
        gainNode.connect(audioCtx.destination);
        oscillator.type = 'sine';
        oscillator.frequency.value = 440;
        gainNode.gain.setValueAtTime(0, audioCtx.currentTime);
        gainNode.gain.linearRampToValueAtTime(1, audioCtx.currentTime + 0.01);
        gainNode.gain.linearRampToValueAtTime(0, audioCtx.currentTime + 0.1);
        oscillator.start(audioCtx.currentTime);
        oscillator.stop(audioCtx.currentTime + 0.1);
    } catch (e) {
        console.error("Error playing beep:", e);
    }
}

function speakText(text, isHighPriority = false) {
    if (!('speechSynthesis' in window)) {
        return;
    }

    // Ensure voices are loaded. If not, try loading them again.
    if (synthesisVoices.length === 0) {
        loadVoices();
    }

    // If still no voices, we cannot proceed.
    if (synthesisVoices.length === 0) {
        console.error("Cannot speak: No speech synthesis voices available.");
        return;
    }

    if (isHighPriority) {
        window.speechSynthesis.cancel();
    }

    const utterance = new SpeechSynthesisUtterance(text);
    
    // *** CRITICAL FIX: Explicitly set a voice. ***
    // We'll use the first available voice. This is the most reliable way.
    utterance.voice = synthesisVoices[0];
    
    utterance.onerror = (event) => {
        if (event.error !== 'interrupted') {
            console.error('SpeechSynthesisUtterance.onerror', event);
        }
    };
    
    window.speechSynthesis.speak(utterance);
}


fetch('/flip_camera', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ flip: isFlipped })
}).catch(error => console.error('Error:', error));

if (navigator.mediaDevices.getUserMedia) {
    navigator.mediaDevices.getUserMedia({ video: true })
        .then(stream => {
            video.srcObject = stream;
            sendFrame();
        })
        .catch(error => {
            console.error("Could not access the webcam.", error);
            predictionElement.innerText = "Error: Webcam not available.";
        });
}

clearButton.addEventListener('click', () => {
    fetch('/clear_text', { method: 'POST' })
        .then(response => response.json())
        .then(data => {
            if (data.status === 'success') {
                recognizedTextElement.innerText = '';
                lastRecognizedText = "";
                window.speechSynthesis.cancel();
            }
        })
        .catch(error => console.error('Error:', error));
});

flipButton.addEventListener('click', () => {
    isFlipped = !isFlipped;
    video.style.transform = isFlipped ? 'scaleX(-1)' : 'scaleX(1)';
    fetch('/flip_camera', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ flip: isFlipped })
    }).catch(error => console.error('Error:', error));
});

colorButton.addEventListener('click', () => {
    currentColorIndex = (currentColorIndex + 1) % colors.length;
    document.body.style.backgroundColor = colors[currentColorIndex];
});

speakButton.addEventListener('click', () => {
    const textToSpeak = recognizedTextElement.innerText;
    if (textToSpeak.trim() !== "") {
        speakText(textToSpeak, true);
    }
});

function sendFrame() {
    if (video.readyState < video.HAVE_ENOUGH_DATA) {
        setTimeout(sendFrame, interval);
        return;
    }

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    context.drawImage(video, 0, 0, canvas.width, video.videoHeight);
    
    const imageData = canvas.toDataURL('image/jpeg', 0.7);

    fetch('/video_feed', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: imageData })
    })
    .then(response => response.json())
    .then(data => {
        predictionElement.innerText = data.prediction;
        if (data.prediction !== "") {
            recognizedTextElement.innerText = data.captured_text;
        }
        
        if (data.captured_text.length > lastRecognizedText.length) {
            playBeep();
            const lastChar = data.captured_text.slice(-1);
            if (lastChar.trim() !== "") {
                speakText(lastChar, false);
            }
        }
        lastRecognizedText = data.captured_text;
    })
    .catch(error => {
        // Silently ignore network errors.
    })
    .finally(() => {
        setTimeout(sendFrame, interval);
    });
}
