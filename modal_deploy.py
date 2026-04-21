import os
import shutil
import subprocess
from pathlib import Path

import modal

app = modal.App("omnifind-website-live")

DATASET_SLUG = "abdelghanyrageh/amazon-products-visual-cleaned-scraped"
APP_DIR = "/app/OmniFind"
RUNTIME_BASE = "/app/runtime"
VISUAL_DATASET_DIR = f"{RUNTIME_BASE}/final_data/visual_dataset"
DATASET_CSV_PATH = f"{VISUAL_DATASET_DIR}/Amazon-Products-Visual.csv"
CANONICAL_FINAL_CSV = f"{RUNTIME_BASE}/data/Amazon-Products-Final.csv"
VISUAL_EMBEDDINGS_PATH = f"{VISUAL_DATASET_DIR}/embeddings_dino.npy"

LOCAL_REPO_DIR = "/home/abghany/amzon/website/OmniFind"

kaggle_secret = modal.Secret.from_name(
    "kaggle-api",
    required_keys=["KAGGLE_USERNAME", "KAGGLE_KEY"],
)
runtime_volume = modal.Volume.from_name("omnifind-runtime", create_if_missing=True)
model_cache_volume = modal.Volume.from_name("omnifind-model-cache", create_if_missing=True)

image = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install("curl", "git", "unzip", "ffmpeg")
    .run_commands("curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && apt-get install -y nodejs")
    .pip_install(
        "numpy",
        "pandas",
        "scipy",
        "qdrant-client",
        "accelerate",
        "transformers==4.41.2",
        "FlagEmbedding==1.2.10",
        "huggingface_hub",
        "kaggle",
        "faster-whisper",
        "scikit-learn",
        "python-dotenv",
        "pymongo",
        "Pillow",
        "torch",
        "torchvision",
        "torchaudio",
    )
    .add_local_dir(
        LOCAL_REPO_DIR,
        remote_path=APP_DIR,
        copy=True,
        ignore=[
            "**/.git/**",
            "**/.venv/**",
            "**/__pycache__/**",
            "**/node_modules/**",
            "**/.env",
            "**/uploads/**",
            "**/mongodb-memory/**",
            "**/qdrant_local_db/**",
            "**/*.sqlite",
            "**/data/**",
        ],
    )
    .run_commands(
        f"cd {APP_DIR} && npm install --omit=dev",
        f"cd {APP_DIR}/frontend && npm install && npm run build",
    )
)


def ensure_kaggle_dataset():
    Path("/root/.kaggle").mkdir(parents=True, exist_ok=True)
    kaggle_json_path = Path("/root/.kaggle/kaggle.json")
    kaggle_json_path.write_text(
        (
            '{"username":"'
            + os.environ["KAGGLE_USERNAME"]
            + '","key":"'
            + os.environ["KAGGLE_KEY"]
            + '"}'
        ),
        encoding="utf-8",
    )
    os.chmod(kaggle_json_path, 0o600)

    image_dir = Path(VISUAL_DATASET_DIR) / "images"
    csv_path = Path(DATASET_CSV_PATH)
    final_csv_path = Path(CANONICAL_FINAL_CSV)
    if image_dir.exists() and csv_path.exists():
        final_csv_path.parent.mkdir(parents=True, exist_ok=True)
        if not final_csv_path.exists():
            shutil.copy2(csv_path, final_csv_path)
        return

    cache_dir = Path("/tmp/kaggle_cache")
    cache_dir.mkdir(parents=True, exist_ok=True)
    zip_path = cache_dir / "amazon-products-visual-cleaned-scraped.zip"

    subprocess.run(
        ["kaggle", "datasets", "download", "-d", DATASET_SLUG, "-p", str(cache_dir), "--force"],
        check=True,
    )
    Path(VISUAL_DATASET_DIR).mkdir(parents=True, exist_ok=True)
    subprocess.run(["unzip", "-oq", str(zip_path), "-d", VISUAL_DATASET_DIR], check=True)

    final_csv_path.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(csv_path, final_csv_path)


def ensure_visual_embeddings():
    import numpy as np
    import pandas as pd
    import torch
    from PIL import Image
    from torchvision import transforms

    emb_path = Path(VISUAL_EMBEDDINGS_PATH)
    csv_path = Path(DATASET_CSV_PATH)
    if emb_path.exists():
        return

    if not csv_path.exists():
        raise RuntimeError(f"Cannot create embeddings; missing CSV at {csv_path}")

    df = pd.read_csv(csv_path)
    preprocess = transforms.Compose(
        [
            transforms.Resize(256),
            transforms.CenterCrop(224),
            transforms.ToTensor(),
            transforms.Normalize(mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225]),
        ]
    )
    device = "cuda" if torch.cuda.is_available() else "cpu"
    model = torch.hub.load("facebookresearch/dinov2", "dinov2_vits14")
    model.to(device).eval()

    embeddings = []
    missing = 0
    for rel in df["image"].fillna(""):
        rel_path = str(rel).lstrip("./").strip()
        image_path = Path(VISUAL_DATASET_DIR) / rel_path
        if not rel_path or not image_path.exists():
            missing += 1
            continue
        with Image.open(image_path).convert("RGB") as img:
            x = preprocess(img).unsqueeze(0).to(device)
        with torch.no_grad():
            feat = model(x)
            feat = feat / feat.norm(dim=-1, keepdim=True)
        embeddings.append(feat.squeeze(0).detach().cpu().numpy().astype("float32"))

    if missing > 0:
        raise RuntimeError(f"Missing {missing} images while building embeddings.")
    if len(embeddings) != len(df):
        raise RuntimeError(f"Embeddings count mismatch: {len(embeddings)} != {len(df)}")

    emb_path.parent.mkdir(parents=True, exist_ok=True)
    np.save(emb_path, np.vstack(embeddings).astype("float32"))


@app.function(
    image=image,
    secrets=[kaggle_secret],
    volumes={
        RUNTIME_BASE: runtime_volume,
        "/cache": model_cache_volume,
    },
    max_containers=1,
    timeout=3600,
)
@modal.web_server(port=5000, startup_timeout=1800)
def serve_omnifind():
    ensure_kaggle_dataset()
    ensure_visual_embeddings()
    runtime_volume.commit()
    model_cache_volume.commit()

    env = os.environ.copy()
    env["PORT"] = "5000"
    env["AMZON_BASE_DIR"] = RUNTIME_BASE
    env["VISUAL_DATASET_DIR"] = VISUAL_DATASET_DIR
    env["TORCH_HOME"] = "/cache/torch"
    env["HF_HOME"] = "/cache/huggingface"
    env["TRANSFORMERS_CACHE"] = "/cache/huggingface/transformers"
    env["DINO_PYTHON_BIN"] = "python"
    env["QDRANT_TEXT_ENCODER"] = "bge"
    env["OMNIFIND_TEXT_INTENT_MODE"] = "llm"
    env["OMNIFIND_TEXT_DEVICE"] = "cuda"
    env["OMNIFIND_INTENT_DEVICE"] = "cuda"
    env["JWT_SECRET"] = env.get("JWT_SECRET", "omnifind-modal-jwt-secret")
    env["STT_DEVICE"] = "cpu"
    env["STT_COMPUTE_TYPE"] = "int8"

    subprocess.Popen(["node", "server.js"], cwd=APP_DIR, env=env)
