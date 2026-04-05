import json
import os
import sys

import numpy as np
import pandas as pd
import torch
from PIL import Image
from qdrant_client import QdrantClient
from qdrant_client.http import models
from torchvision import transforms


BASE_AMZON_DIR = os.environ.get("AMZON_BASE_DIR", "/home/abghany/amzon")
OMNIFIND_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
VISUAL_DATASET_DIR = os.environ.get(
    "VISUAL_DATASET_DIR",
    os.path.join(BASE_AMZON_DIR, "final_data", "visual_dataset"),
)
VISUAL_CSV_PATH = os.path.join(VISUAL_DATASET_DIR, "Amazon-Products-Visual.csv")
VISUAL_EMB_PATH = os.path.join(VISUAL_DATASET_DIR, "embeddings_dino.npy")
QDRANT_LOCAL_PATH = os.environ.get(
    "QDRANT_LOCAL_PATH",
    os.path.join(OMNIFIND_DIR, "data", "qdrant_local_db"),
)
QDRANT_COLLECTION = os.environ.get("QDRANT_COLLECTION", "amazon_visual_dino")
QDRANT_URL = os.environ.get("QDRANT_URL", "")
QDRANT_API_KEY = os.environ.get("QDRANT_API_KEY", "")
DEVICE = "cuda" if torch.cuda.is_available() else "cpu"


def _client() -> QdrantClient:
    if QDRANT_URL:
        return QdrantClient(url=QDRANT_URL, api_key=QDRANT_API_KEY or None, timeout=30.0)
    os.makedirs(QDRANT_LOCAL_PATH, exist_ok=True)
    return QdrantClient(path=QDRANT_LOCAL_PATH)


CLIENT = _client()
MODEL = torch.hub.load("facebookresearch/dinov2", "dinov2_vits14")
MODEL.to(DEVICE)
MODEL.eval()
PREPROCESS = transforms.Compose(
    [
        transforms.Resize(256),
        transforms.CenterCrop(224),
        transforms.ToTensor(),
        transforms.Normalize(mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225]),
    ]
)


def _emit(payload):
    sys.stdout.write(json.dumps(payload) + "\n")
    sys.stdout.flush()


def _embed(image_path: str) -> np.ndarray:
    with Image.open(image_path).convert("RGB") as img:
        x = PREPROCESS(img).unsqueeze(0).to(DEVICE)
    with torch.no_grad():
        feat = MODEL(x)
        feat = feat / feat.norm(dim=-1, keepdim=True)
    return feat.squeeze(0).detach().cpu().numpy().astype("float32")


def _sync_pipeline(force: bool = False):
    df = pd.read_csv(VISUAL_CSV_PATH)
    emb = np.load(VISUAL_EMB_PATH).astype("float32")
    if len(df) != len(emb):
        raise RuntimeError(f"CSV rows ({len(df)}) and embeddings ({len(emb)}) mismatch.")

    collections = {c.name for c in CLIENT.get_collections().collections}
    existing_count = 0
    if QDRANT_COLLECTION in collections:
        existing_count = int(CLIENT.count(collection_name=QDRANT_COLLECTION, exact=True).count)
    if not force and existing_count == len(df):
        return {"synced": False, "count": existing_count, "collection": QDRANT_COLLECTION}

    if QDRANT_COLLECTION in collections:
        CLIENT.delete_collection(collection_name=QDRANT_COLLECTION)
    CLIENT.create_collection(
        collection_name=QDRANT_COLLECTION,
        vectors_config=models.VectorParams(
            size=int(emb.shape[1]),
            distance=models.Distance.COSINE,
        ),
    )

    batch_size = 256
    for start in range(0, len(df), batch_size):
        end = min(start + batch_size, len(df))
        points = []
        for i in range(start, end):
            row = df.iloc[i]
            rel_image = str(row.get("image", "")).lstrip("./")
            image_abs = os.path.join(VISUAL_DATASET_DIR, rel_image) if rel_image else ""
            points.append(
                models.PointStruct(
                    id=int(i),
                    vector=emb[i].tolist(),
                    payload={
                        "source": "pipeline1",
                        "pipeline_index": int(i),
                        "name": str(row.get("name", "")),
                        "main_category": str(row.get("main_category", "")),
                        "sub_category": str(row.get("sub_category", "")),
                        "link": str(row.get("link", "")),
                        "image_local": image_abs,
                    },
                )
            )
        CLIENT.upsert(collection_name=QDRANT_COLLECTION, points=points)

    return {"synced": True, "count": len(df), "collection": QDRANT_COLLECTION}


def _search(image_path: str, top_k: int):
    query = _embed(image_path)
    points = CLIENT.query_points(
        collection_name=QDRANT_COLLECTION,
        query=query.tolist(),
        limit=top_k,
        with_payload=True,
        with_vectors=False,
    ).points
    return {
        "hits": [
            {
                "id": str(p.id),
                "score": float(p.score),
                "payload": p.payload or {},
            }
            for p in points
        ]
    }


def _upsert_product(payload):
    vector = _embed(payload["image"])
    point = models.PointStruct(
        id=f"product:{payload['product_id']}",
        vector=vector.tolist(),
        payload={
            "source": "admin_upload",
            "product_id": str(payload["product_id"]),
            "name": payload.get("name", ""),
            "main_category": payload.get("main_category", ""),
            "sub_category": payload.get("sub_category", ""),
            "link": payload.get("link", ""),
            "image_local": payload.get("image_local", ""),
        },
    )
    CLIENT.upsert(collection_name=QDRANT_COLLECTION, points=[point])
    return {"upserted": True, "id": f"product:{payload['product_id']}"}


def _delete_product(product_id):
    CLIENT.delete(
        collection_name=QDRANT_COLLECTION,
        points_selector=models.PointIdsList(points=[f"product:{product_id}"]),
    )
    return {"deleted": True, "id": f"product:{product_id}"}


def main():
    _sync_pipeline(force=False)
    _emit({"ready": True})
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            req = json.loads(line)
            cmd = req.get("cmd")
            req_id = req.get("id")
            if cmd == "sync-pipeline":
                result = _sync_pipeline(force=bool(req.get("force")))
            elif cmd == "search":
                result = _search(req["image"], int(req.get("top_k", 12)))
            elif cmd == "upsert-product":
                result = _upsert_product(req)
            elif cmd == "delete-product":
                result = _delete_product(req["product_id"])
            else:
                raise RuntimeError(f"Unknown command: {cmd}")
            _emit({"id": req_id, "ok": True, "result": result})
        except Exception as exc:
            _emit({"id": req.get("id") if "req" in locals() and isinstance(req, dict) else None, "ok": False, "error": str(exc)})


if __name__ == "__main__":
    main()
