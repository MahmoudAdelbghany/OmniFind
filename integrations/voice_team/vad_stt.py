import torch
import sounddevice as sd
import numpy as np
import time
import modal

# ── Config ───────────────────────────────────────────────────────────────────
SAMPLE_RATE      = 16000
CHUNK_SAMPLES    = 8000       # 0.5s per read
WINDOW_SAMPLES   = 512        # Silero v5 required window size
THRESHOLD        = 0.5
SILENCE_TIMEOUT  = 1.5        # seconds of silence → END

# ── Load Silero VAD ───────────────────────────────────────────────────────────
print("Loading Silero VAD v5...")
model_vad, utils = torch.hub.load(
    repo_or_dir="snakers4/silero-vad",
    model="silero_vad",
    force_reload=False,
    trust_repo=True
)
print("VAD ready.\n")

# ── Load Modal STT function ───────────────────────────────────────────────────
transcribe = modal.Function.from_name("omnifind-stt", "transcribe")

# ── State ─────────────────────────────────────────────────────────────────────
is_speaking      = False
silence_start    = None
speech_buffer    = []         # accumulates float32 samples during speech

def send_to_modal(audio_np: np.ndarray):
    """Send buffered audio to Modal and print result."""
    print("  ⏳ Sending to Modal...", flush=True)
    t0 = time.time()

    result = transcribe.remote(
        audio_np.astype(np.float32).tobytes(),
        SAMPLE_RATE
    )

    round_trip = round(time.time() - t0, 2)

    print(f"\n📝  Transcript  : {result['transcript']}")
    print(f"⏱️   STT latency : {result['latency_s']}s  (round-trip: {round_trip}s)")
    print(f"🌐  Language    : {result['language']} (conf: {result['language_prob']})")
    print("-" * 55)

def process_chunk(audio_chunk: np.ndarray):
    """Run VAD on chunk, buffer speech, trigger STT on END."""
    global is_speaking, silence_start, speech_buffer

    num_windows = len(audio_chunk) // WINDOW_SAMPLES

    for i in range(num_windows):
        window = audio_chunk[i * WINDOW_SAMPLES : (i + 1) * WINDOW_SAMPLES]
        tensor = torch.from_numpy(window.astype(np.float32))
        prob   = model_vad(tensor, SAMPLE_RATE).item()

        if prob >= THRESHOLD:
            silence_start = None
            speech_buffer.append(window)

            if not is_speaking:
                is_speaking = True
                print(f"\n[{time.strftime('%H:%M:%S')}] 🎙  Speech START")
            else:
                print(f"  … speaking  prob={prob:.2f}", end="\r")

        else:
            if is_speaking:
                speech_buffer.append(window)   # keep tail context

                if silence_start is None:
                    silence_start = time.time()

                elif time.time() - silence_start >= SILENCE_TIMEOUT:
                    print(f"\n[{time.strftime('%H:%M:%S')}] 🔇  Speech END")
                    is_speaking   = False
                    silence_start = None

                    audio_np = np.concatenate(speech_buffer)
                    speech_buffer = []
                    send_to_modal(audio_np)

            else:
                print(f"  … silence   prob={prob:.2f}", end="\r")

# ── Main loop ─────────────────────────────────────────────────────────────────
print("Listening — speak into your mic  (Ctrl+C to stop)\n")
print(f"  Threshold   : {THRESHOLD}")
print(f"  Silence gap : {SILENCE_TIMEOUT}s\n")

try:
    with sd.InputStream(
        samplerate=SAMPLE_RATE,
        channels=1,
        dtype="float32",
        blocksize=CHUNK_SAMPLES,
    ) as stream:
        while True:
            chunk, _ = stream.read(CHUNK_SAMPLES)
            process_chunk(chunk[:, 0])

except KeyboardInterrupt:
    print("\n\nStopped.")

