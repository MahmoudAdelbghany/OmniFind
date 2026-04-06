import os
import time
import pickle
import faiss
import numpy as np
import warnings
warnings.filterwarnings("ignore")
os.environ["OMP_NUM_THREADS"] = "1"
os.environ["TOKENIZERS_PARALLELISM"] = "false"

from sentence_transformers import SentenceTransformer

# ── Paths ─────────────────────────────────────────────────────────────────────
SCRIPT_DIR   = os.path.dirname(os.path.abspath(__file__))
FAISS_PATH   = os.path.join(SCRIPT_DIR, "alt_faiss_index.bin")
DOC_MAP_PATH = os.path.join(SCRIPT_DIR, "alt_doc_map.pkl")
TOP_N        = 10

# ── Load search components (always needed) ────────────────────────────────────
print("Loading FAISS index...")
index = faiss.read_index(FAISS_PATH)

print("Loading document map...")
with open(DOC_MAP_PATH, "rb") as f:
    doc_map = pickle.load(f)

print("Loading embedding model (MiniLM-L6-v2)...")
embed_model = SentenceTransformer("all-MiniLM-L6-v2")

print("✅ Search engine ready.\n")

# ── Search ────────────────────────────────────────────────────────────────────
def search(query: str, top_n: int = TOP_N):
    t0 = time.time()
    query_vec = embed_model.encode([query], normalize_embeddings=True).astype(np.float32)
    distances, indices = index.search(query_vec, k=top_n)
    latency = round(time.time() - t0, 3)

    results = []
    for dist, idx in zip(distances[0], indices[0]):
        row = doc_map.iloc[idx]
        results.append({
            "name"    : row.get("name", "N/A"),
            "category": row.get("main_category", "N/A"),
            "price"   : row.get("discount_price_usd", None),
            "rating"  : row.get("ratings", None),
            "score"   : round(float(dist), 4),
        })
    return results, latency

# ── Print results ─────────────────────────────────────────────────────────────
def print_results(query, results, latency, voice_latency=None):
    print("\n" + "="*70)
    print(f"🔍 Query        : {query}")
    print(f"⏱️  Search time  : {latency}s")
    if voice_latency:
        print(f"🎙️  Voice→Result : {voice_latency}s  (includes STT + search)")
    print("="*70)

    for i, r in enumerate(results, 1):
        name  = r["name"][:65] + "..." if len(r["name"]) > 65 else r["name"]
        price = f"${r['price']:.2f}" if r["price"] else "N/A"
        rating = f"★{float(r['rating']):.1f}" if r["rating"] else "N/A"
        print(f"{i:2d}. {rating} | {price} | [{r['category']}]")
        print(f"    {name}")
        print()

# ── Text mode ─────────────────────────────────────────────────────────────────
def run_text_mode():
    print("📝 TEXT MODE — type your query, 'exit' to quit.\n")
    while True:
        try:
            query = input("🔍 Search: ").strip()
            if not query or query.lower() in ["exit", "quit"]:
                break
            results, latency = search(query)
            print_results(query, results, latency)
        except KeyboardInterrupt:
            break

# ── Voice mode ────────────────────────────────────────────────────────────────
def run_voice_mode():
    import torch
    import sounddevice as sd
    import modal

    print("Loading Silero VAD...")
    model_vad, _ = torch.hub.load(
        repo_or_dir="snakers4/silero-vad",
        model="silero_vad",
        force_reload=False,
        trust_repo=True
    )
    print("Connecting to Modal STT...")
    transcribe = modal.Function.from_name("omnifind-stt", "transcribe")
    print("🎙️  VOICE MODE — speak your query, Ctrl+C to quit.\n")

    SAMPLE_RATE    = 16000
    CHUNK_SAMPLES  = 8000
    WINDOW_SAMPLES = 512
    THRESHOLD      = 0.5
    SILENCE_TIMEOUT = 1.5

    is_speaking    = False
    silence_start  = None
    speech_buffer  = []
    voice_start_time = None

    def process_chunk(audio_chunk):
        nonlocal is_speaking, silence_start, speech_buffer, voice_start_time

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
                    voice_start_time = time.time()
                    print(f"\n[{time.strftime('%H:%M:%S')}] 🎙  Speech START")
                else:
                    print(f"  … speaking  prob={prob:.2f}", end="\r")

            else:
                if is_speaking:
                    speech_buffer.append(window)
                    if silence_start is None:
                        silence_start = time.time()
                    elif time.time() - silence_start >= SILENCE_TIMEOUT:
                        print(f"\n[{time.strftime('%H:%M:%S')}] 🔇  Speech END")
                        is_speaking   = False
                        silence_start = None

                        audio_np = np.concatenate(speech_buffer)
                        speech_buffer.clear()

                        # STT
                        print("  ⏳ Transcribing...")
                        stt_result = transcribe.remote(
                            audio_np.astype(np.float32).tobytes(),
                            SAMPLE_RATE
                        )
                        transcript = stt_result["transcript"].strip()
                        if not transcript:
                            print("  ⚠️  No speech detected, try again.")
                            return

                        print(f"  📝 Transcript : {transcript}")
                        print(f"  ⏱️  STT latency : {stt_result['latency_s']}s")

                        # Search
                        results, search_latency = search(transcript)
                        voice_latency = round(time.time() - voice_start_time, 2)
                        print_results(transcript, results, search_latency, voice_latency)
                else:
                    print(f"  … silence   prob={prob:.2f}", end="\r")

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

# ── Entry point ───────────────────────────────────────────────────────────────
if __name__ == "__main__":
    print("="*50)
    print("       OmniFind — Product Search")
    print("="*50)
    print("\nSelect input mode:")
    print("  1. Text")
    print("  2. Voice")

    while True:
        choice = input("\n> ").strip()
        if choice == "1":
            run_text_mode()
            break
        elif choice == "2":
            run_voice_mode()
            break
        else:
            print("Please enter 1 or 2.")