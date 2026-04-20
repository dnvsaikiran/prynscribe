// offscreen/recorder.js
// Handles audio capture using tabCapture streamId.

let activeStream = null;
let chunkId = 0;
let heartbeatInterval = null;
let chunkTimeoutId = null;
let activeLectureId = null;
let sessionSpeed = 1.0;
let sharedAudioCtx = null;
let currentSignalLevel = 0; // Live tracking for VAD

function getAudioCtx() {
    if (!sharedAudioCtx) sharedAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
    return sharedAudioCtx;
}

async function startRecording(streamId, lectureId, speed = 1.0) {
  console.log(`[Recorder] Starting recording for lecture ${lectureId} with speed ${speed} and streamId ${streamId}`);
  try {
    activeLectureId = lectureId ? lectureId.toString() : null;
    sessionSpeed = speed || 1.0;
    
    // Create a new stream from the tab capture streamId
    const constraints = {
      audio: {
        mandatory: {
          chromeMediaSource: 'tab',
          chromeMediaSourceId: streamId
        }
      },
      video: false
    };
    
    console.log("[Recorder] Calling getUserMedia with constraints:", JSON.stringify(constraints));
    activeStream = await navigator.mediaDevices.getUserMedia(constraints);
    console.log("[Recorder] getUserMedia success. Active tracks:", activeStream.getAudioTracks().length);

    // --- TRACK TERMINATION DETECTION ---
    activeStream.getAudioTracks().forEach(track => {
        track.onended = () => {
            console.warn("[Recorder] Audio track ended unexpectedly.");
            chrome.runtime.sendMessage({ 
                type: 'recorderError', 
                error: 'Audio stream lost. Please ensure the tab is active and not reloaded.' 
            });
            stopRecording();
        };
    });

    // --- LOOPBACK ---
    // Ensure the user still hears the audio while we record it
    // IMPORTANT: This loopback is for human hearing. 
    // The MediaRecorder below captures the raw stream directly from the source,
    // so it is NOT affected by the tab's volume or this audio element's volume.
    const audio = new Audio();
    audio.srcObject = activeStream;
    audio.play();

    // --- GAIN NORMALIZATION (Prevent Low Volume Capture) ---
    // Even if the source tab is at 1%, we can boost the signal for the AI
    const audioCtx = getAudioCtx();
    const source = audioCtx.createMediaStreamSource(activeStream);
    const gainNode = audioCtx.createGain();
    const destination = audioCtx.createMediaStreamDestination();
    
    // Boost signal by 5x to ensure transcription works even if original was quiet
    gainNode.gain.value = 5.0; 
    
    source.connect(gainNode);
    
    // --- DYNAMICS COMPRESSION (Clipping Protection) ---
    const compressor = audioCtx.createDynamicsCompressor();
    compressor.threshold.setValueAtTime(-24, audioCtx.currentTime); // Start compressing at -24dB
    compressor.knee.setValueAtTime(30, audioCtx.currentTime);
    compressor.ratio.setValueAtTime(12, audioCtx.currentTime);
    compressor.attack.setValueAtTime(0.003, audioCtx.currentTime);
    compressor.release.setValueAtTime(0.25, audioCtx.currentTime);
    
    gainNode.connect(compressor);
    compressor.connect(destination);

    // --- LIVE SIGNAL MONITORING ---
    const analyzer = audioCtx.createAnalyser();
    analyzer.fftSize = 128;
    gainNode.connect(analyzer);
    const dataArray = new Uint8Array(analyzer.frequencyBinCount);

    const checkSignal = setInterval(() => {
        if (!activeLectureId) { clearInterval(checkSignal); return; }
        analyzer.getByteFrequencyData(dataArray);
        const average = dataArray.reduce((p, c) => p + c, 0) / dataArray.length;
        currentSignalLevel = average; // Update for VAD logic
        
        // --- REAL-TIME TELEMETRY (40ms = 25fps) ---
        chrome.runtime.sendMessage({ type: 'signal_level', level: average });
    }, 40);

    // --- NUCLEAR RECORDER CYCLE ---
    const recordNextChunk = () => {
        if (!activeLectureId || !activeStream) return;

        // Capture from the boosted destination stream, not the raw activeStream
        const recorder = new MediaRecorder(destination.stream, { 
            mimeType: 'audio/webm',
            audioBitsPerSecond: 192000 
        });
        const currentChunkId = chunkId++;

        console.log(`[Recorder] Initialized MediaRecorder for chunk ${currentChunkId}. State: ${recorder.state}`);

        recorder.ondataavailable = async (event) => {
            console.log(`[Recorder] ondataavailable for chunk ${currentChunkId}. Size: ${event.data.size} bytes`);
            if (event.data && event.data.size > 2000) { 
                try {
                    let audioData = event.data;

                    // --- 5X SPEED NORMALIZATION ---
                    // If speed is significantly high, we slow down the audio back to 1x pitch/speed
                    if (sessionSpeed > 1.2) {
                        console.log(`[Recorder] Normalizing ${sessionSpeed}x chunk ${currentChunkId} (${(event.data.size/1024).toFixed(1)} KB)...`);
                        audioData = await normalizeAudioSpeed(event.data, sessionSpeed);
                        if (audioData) {
                            console.log(`[Recorder] Normalization success. New size: ${(audioData.size/1024).toFixed(1)} KB`);
                        } else {
                            console.error("[Recorder] Normalization failed, sending raw chunk as fallback.");
                            audioData = event.data;
                        }
                    }

                    const reader = new FileReader();
                    reader.readAsDataURL(audioData);
                    reader.onloadend = () => {
                        chrome.runtime.sendMessage({
                            type: 'saveChunk',
                            lectureId: activeLectureId,
                            chunkId: currentChunkId,
                            audioBase64: reader.result
                        });
                    };
                } catch (e) {
                    console.error("[Recorder] Failed to process chunk:", e);
                }
            }
        };

        recorder.onerror = (e) => {
            console.error(`[Recorder] MediaRecorder error for chunk ${currentChunkId}:`, e);
        };

        recorder.start();
        
        // --- SMART VAD CHUNKING ---
        // Basic duration: 5s for first chunk, 20s thereafter
        const targetDuration = currentChunkId === 0 ? 5000 : 20000;
        const maxExtension = 10000; // Max 10s extension to find silence
        const checkInterval = 500;
        let elapsed = 0;

        const handleChunkCompletion = () => {
            if (!activeLectureId) return;

            // If we've hit target duration AND it's silent (or we hit max extension)
            // Threshold 0.5 is very low-level background noise after 5x boost
            const isSilent = currentSignalLevel < 0.5; 
            
            if ((elapsed >= targetDuration && isSilent) || elapsed >= (targetDuration + maxExtension)) {
                if (recorder.state === 'recording') recorder.stop();
                if (activeLectureId) recordNextChunk();
            } else {
                elapsed += checkInterval;
                chunkTimeoutId = setTimeout(handleChunkCompletion, checkInterval);
            }
        };

        chunkTimeoutId = setTimeout(handleChunkCompletion, checkInterval);
    };

    recordNextChunk();

    // --- HEARTBEAT ---
    if (heartbeatInterval) clearInterval(heartbeatInterval);
    heartbeatInterval = setInterval(() => {
        try {
            chrome.runtime.sendMessage({ type: 'keepAlive' }).catch(() => stopRecording());
        } catch (e) { stopRecording(); }
    }, 10000);

  } catch (err) {
    console.error('Recorder start error:', err);
    chrome.runtime.sendMessage({ type: 'recorderError', error: err.message });
  }
}

/**
 * Uses OfflineAudioContext to slow down audio back to 1x pitch/speed.
 * This ensures transcription engines (Deepgram/Whisper) can understand 5x lectures.
 */
async function normalizeAudioSpeed(blob, speed) {
    try {
        const audioCtx = getAudioCtx();
        const arrayBuffer = await blob.arrayBuffer();
        
        // Use a standard sample rate to avoid decoding issues
        const targetSampleRate = 44100;
        
        // Decodes the compressed WebM chunk into PCM
        const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
        
        // Check for signal
        const data = audioBuffer.getChannelData(0);
        let hasSignal = false;
        const checkStep = Math.max(1, Math.floor(data.length / 1000));
        for(let i=0; i<data.length; i+=checkStep) { 
            if(Math.abs(data[i]) > 0.002) { // Lowered threshold from 0.005
                hasSignal = true; 
                break; 
            } 
        }
        
        if (!hasSignal) {
            console.warn("[Recorder] Chunk appears silent or noise-only.");
            return null;
        }

        // Calculate output duration
        const outputLength = Math.ceil(audioBuffer.length * speed);
        
        // We use OfflineAudioContext to stretch the audio
        // Using a high sample rate (48k) for better fidelity during stretching
        const offlineCtx = new OfflineAudioContext(
            audioBuffer.numberOfChannels,
            outputLength,
            48000
        );
        
        const source = offlineCtx.createBufferSource();
        source.buffer = audioBuffer;
        
        // --- ClearVoice Upgrades ---
        // 1. High-Pass Filter: Removes low-end mud/rumble (80Hz)
        const filter = offlineCtx.createBiquadFilter();
        filter.type = 'highpass';
        filter.frequency.value = 80;
        
        // 2. Dynamics Compressor: Toughens up the voice so words don't get 'lost'
        const compressor = offlineCtx.createDynamicsCompressor();
        compressor.threshold.setValueAtTime(-24, offlineCtx.currentTime);
        compressor.knee.setValueAtTime(30, offlineCtx.currentTime);
        compressor.ratio.setValueAtTime(12, offlineCtx.currentTime);
        compressor.attack.setValueAtTime(0.003, offlineCtx.currentTime);
        compressor.release.setValueAtTime(0.25, offlineCtx.currentTime);
        
        // --- Connection Chain ---
        source.playbackRate.value = 1 / speed; 
        source.connect(filter);
        filter.connect(compressor);
        compressor.connect(offlineCtx.destination);
        
        source.start(0);
        console.log(`[Recorder] ClearVoice Compression Active for ${speed}x normalize.`);
        
        const renderedBuffer = await offlineCtx.startRendering();
        console.log(`[Recorder] 3x+ Normalization complete. Duration: ${(renderedBuffer.duration).toFixed(1)}s`);
        return bufferToWav(renderedBuffer);
    } catch (e) {
        console.error("[Recorder] Normalization CRITICAL FAILURE:", e);
        // Log more details back to the worker
        chrome.runtime.sendMessage({ 
            type: 'debug_log', 
            message: `Normalization failed for ${speed}x: ${e.message}` 
        });
        return null;
    }
}

function bufferToWav(abuffer) {
    let numOfChan = abuffer.numberOfChannels,
        length = abuffer.length * numOfChan * 2 + 44,
        buffer = new ArrayBuffer(length),
        view = new DataView(buffer),
        channels = [], i, sample,
        offset = 0,
        pos = 0;

    // write WAVE header
    setUint32(0x46464952);                         // "RIFF"
    setUint32(length - 8);                         // file length - 8
    setUint32(0x45564157);                         // "WAVE"

    setUint32(0x20746d66);                         // "fmt " chunk
    setUint32(16);                                 // length = 16
    setUint16(1);                                  // PCM (uncompressed)
    setUint16(numOfChan);
    setUint32(abuffer.sampleRate);
    setUint32(abuffer.sampleRate * 2 * numOfChan); // avg. bytes/sec
    setUint16(numOfChan * 2);                      // block-align
    setUint16(16);                                 // 16-bit

    setUint32(0x61746164);                         // "data" - chunk
    setUint32(length - pos - 4);                   // chunk length

    // write interleaved data
    for(i=0; i<abuffer.numberOfChannels; i++)
        channels.push(abuffer.getChannelData(i));

    while(pos < length) {
        for(i=0; i<numOfChan; i++) {             // interleave channels
            sample = Math.max(-1, Math.min(1, channels[i][offset])); // clamp
            sample = (0.5 + sample < 0 ? sample * 32768 : sample * 32767)|0; // scale to 16-bit signed int
            view.setInt16(pos, sample, true);          // write 16-bit sample
            pos += 2;
        }
        offset++;                                     // next sample for all channels
    }

    return new Blob([buffer], {type: "audio/wav"});

    function setUint16(data) {
        view.setUint16(pos, data, true);
        pos += 2;
    }

    function setUint32(data) {
        view.setUint32(pos, data, true);
        pos += 4;
    }
}

async function stopRecording() {
  if (heartbeatInterval) {
    clearInterval(heartbeatInterval);
    heartbeatInterval = null;
  }
  
  if (chunkTimeoutId) {
    clearTimeout(chunkTimeoutId);
    chunkTimeoutId = null;
  }

  if (activeStream) {
      activeStream.getTracks().forEach(t => t.stop());
      activeStream = null;
  }
  
  activeLectureId = null;
  chunkId = 0;
  // Don't close sharedAudioCtx as we might restart a session
}

async function getCurrentLectureId() {
  try {
    if (!chrome?.runtime?.id) return null;
    const result = await chrome.storage.local.get(['currentLectureId']);
    return result.currentLectureId || null;
  } catch (e) {
    return null;
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'start') {
    startRecording(msg.streamId, msg.lectureId, msg.speed);
    sendResponse({ status: 'started' });
    return false;
  } else if (msg.type === 'stop') {
    stopRecording();
    sendResponse({ status: 'stopped' });
    return false;
  } else if (msg.type === 'ping_offscreen') {
    sendResponse({ status: 'pong' });
    return false;
  }
  return false;
});

// Notify background that we are ready
chrome.runtime.sendMessage({ type: 'offscreen_ready' });

// Handle unexpected closure
window.addEventListener('beforeunload', () => {
    chrome.runtime.sendMessage({ type: 'recorderError', error: 'Offscreen document closed unexpectedly.' });
});

// Notify background that we are ready
chrome.runtime.sendMessage({ type: 'offscreen_ready' });
