import modal

app = modal.App("omnifind-stt")

image = (
    modal.Image.from_registry(
        "nvidia/cuda:12.1.0-cudnn8-runtime-ubuntu22.04",
        add_python="3.11"
    )
    .env({"CACHE_BUST": "3"})
    .pip_install([
        "faster-whisper==1.1.0",
        "numpy",
        "requests",
        "huggingface-hub",
    ])
)

@app.function(
    image=image,
    gpu="A10G",
    timeout=60,
    scaledown_window=300,
)
def transcribe(audio_bytes: bytes, sample_rate: int = 16000) -> dict:
    import numpy as np
    import time
    from faster_whisper import WhisperModel

    model = WhisperModel(
        "large-v3-turbo",
        device="cuda",
        compute_type="int8"
    )

    audio_np = np.frombuffer(audio_bytes, dtype=np.float32)

    t_start = time.time()
    segments, info = model.transcribe(
        audio_np,
        language="en",
        beam_size=5,
        vad_filter=False,
    )
    transcript = " ".join(seg.text.strip() for seg in segments)
    latency = round(time.time() - t_start, 2)

    return {
        "transcript": transcript,
        "latency_s": latency,
        "language": info.language,
        "language_prob": round(info.language_probability, 2)
    }