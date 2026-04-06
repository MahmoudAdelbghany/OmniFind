import json
import os
import sys

import faiss
import numpy as np
import pandas as pd
import torch
from PIL import Image
from qdrant_client import QdrantClient
from qdrant_client.http import models
from sentence_transformers import SentenceTransformer
from torchvision import transforms


BASE_AMZON_DIR = os.environ.get("AMZON_BASE_DIR", "/home/abghany/amzon")
OMNIFIND_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
VISUAL_DATASET_DIR = os.environ.get(
    "VISUAL_DATASET_DIR",
    os.path.join(BASE_AMZON_DIR, "final_data", "visual_dataset"),
)
VISUAL_CSV_PATH = os.path.join(VISUAL_DATASET_DIR, "Amazon-Products-Visual.csv")
VISUAL_EMB_PATH = os.path.join(VISUAL_DATASET_DIR, "embeddings_dino.npy")
VOICE_TEAM_DIR = os.environ.get(
    "VOICE_TEAM_DIR",
    os.path.join(OMNIFIND_DIR, "integrations", "voice_team"),
)
TEXT_FAISS_PATH = os.path.join(VOICE_TEAM_DIR, "alt_faiss_index.bin")
TEXT_DOC_MAP_PATH = os.path.join(VOICE_TEAM_DIR, "alt_doc_map.pkl")
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
TEXT_MODEL = SentenceTransformer("all-MiniLM-L6-v2")
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


def _embed_text(text: str) -> np.ndarray:
    vector = TEXT_MODEL.encode([text], normalize_embeddings=True).astype("float32")[0]
    return vector


def _compose_text(row: pd.Series | dict) -> str:
    item = row if isinstance(row, dict) else row.to_dict()
    fields = [
        str(item.get("name", "")),
        str(item.get("main_category", "")),
        str(item.get("sub_category", "")),
        str(item.get("description", "")),
        str(item.get("discount_price_usd", "")),
        str(item.get("actual_price_usd", "")),
    ]
    return " | ".join([f for f in fields if f and f != "nan"])


def _load_text_vectors(df: pd.DataFrame) -> np.ndarray:
    if os.path.exists(TEXT_FAISS_PATH):
        index = faiss.read_index(TEXT_FAISS_PATH)
        if index.ntotal != len(df):
            raise RuntimeError(
                f"Voice-team FAISS count mismatch: index={index.ntotal}, visual_csv={len(df)}."
            )
        vectors = np.vstack([index.reconstruct(i) for i in range(index.ntotal)]).astype("float32")
        return vectors
    return np.vstack([_embed_text(_compose_text(row)) for _, row in df.iterrows()]).astype("float32")


def _resolve_payload_row(visual_row: pd.Series, text_df: pd.DataFrame, idx: int) -> dict:
    text_row = text_df.iloc[idx].to_dict() if idx < len(text_df) else {}
    rel_image = str(visual_row.get("image", "")).lstrip("./")
    image_abs = os.path.join(VISUAL_DATASET_DIR, rel_image) if rel_image else ""
    discount = text_row.get("discount_percentage", None)
    return {
        "source": "pipeline1",
        "pipeline_index": int(idx),
        "name": str(visual_row.get("name", "")),
        "main_category": str(visual_row.get("main_category", "")),
        "sub_category": str(visual_row.get("sub_category", "")),
        "link": str(visual_row.get("link", "")),
        "image_local": image_abs,
        "ratings": float(text_row.get("ratings", visual_row.get("ratings", 0)) or 0),
        "no_of_ratings": float(text_row.get("no_of_ratings", visual_row.get("no_of_ratings", 0)) or 0),
        "discount_price_usd": float(
            text_row.get("discount_price_usd", visual_row.get("discount_price_usd", 0)) or 0
        ),
        "actual_price_usd": float(
            text_row.get("actual_price_usd", visual_row.get("actual_price_usd", 0)) or 0
        ),
        "discount_percentage": float(discount) if discount is not None and str(discount) != "nan" else None,
    }


def _ensure_collection(image_dim: int, text_dim: int):
    collections = {c.name for c in CLIENT.get_collections().collections}
    if QDRANT_COLLECTION not in collections:
        CLIENT.create_collection(
            collection_name=QDRANT_COLLECTION,
            vectors_config={
                "image": models.VectorParams(size=image_dim, distance=models.Distance.COSINE),
                "text": models.VectorParams(size=text_dim, distance=models.Distance.COSINE),
            },
        )
        return
    info = CLIENT.get_collection(QDRANT_COLLECTION)
    vectors = info.config.params.vectors
    has_named_vectors = hasattr(vectors, "keys")
    if not has_named_vectors or "image" not in vectors or "text" not in vectors:
        CLIENT.delete_collection(collection_name=QDRANT_COLLECTION)
        CLIENT.create_collection(
            collection_name=QDRANT_COLLECTION,
            vectors_config={
                "image": models.VectorParams(size=image_dim, distance=models.Distance.COSINE),
                "text": models.VectorParams(size=text_dim, distance=models.Distance.COSINE),
            },
        )


def _sync_pipeline(force: bool = False):
    df = pd.read_csv(VISUAL_CSV_PATH)
    image_vectors = np.load(VISUAL_EMB_PATH).astype("float32")
    if len(df) != len(image_vectors):
        raise RuntimeError(f"CSV rows ({len(df)}) and image embeddings ({len(image_vectors)}) mismatch.")
    text_df = pd.read_pickle(TEXT_DOC_MAP_PATH) if os.path.exists(TEXT_DOC_MAP_PATH) else df.copy()
    text_vectors = _load_text_vectors(df)
    if len(text_vectors) != len(image_vectors):
        raise RuntimeError(
            f"Text vectors ({len(text_vectors)}) and image vectors ({len(image_vectors)}) mismatch."
        )

    _ensure_collection(int(image_vectors.shape[1]), int(text_vectors.shape[1]))
    existing_count = int(CLIENT.count(collection_name=QDRANT_COLLECTION, exact=True).count)
    if not force and existing_count == len(df):
        return {"synced": False, "count": existing_count, "collection": QDRANT_COLLECTION}

    CLIENT.delete_collection(collection_name=QDRANT_COLLECTION)
    _ensure_collection(int(image_vectors.shape[1]), int(text_vectors.shape[1]))

    batch_size = 256
    for start in range(0, len(df), batch_size):
        end = min(start + batch_size, len(df))
        points = []
        for i in range(start, end):
            row = df.iloc[i]
            payload = _resolve_payload_row(row, text_df, i)
            points.append(
                models.PointStruct(
                    id=int(i),
                    vector={
                        "image": image_vectors[i].tolist(),
                        "text": text_vectors[i].tolist(),
                    },
                    payload=payload,
                )
            )
        CLIENT.upsert(collection_name=QDRANT_COLLECTION, points=points)

    return {"synced": True, "count": len(df), "collection": QDRANT_COLLECTION}


def _search(image_path: str, top_k: int):
    query = _embed(image_path)
    points = CLIENT.query_points(
        collection_name=QDRANT_COLLECTION,
        query=query.tolist(),
        using="image",
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


def _search_text(query_text: str, top_k: int):
    query_vector = _embed_text(query_text)
    points = CLIENT.query_points(
        collection_name=QDRANT_COLLECTION,
        query=query_vector.tolist(),
        using="text",
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
    image_vector = _embed(payload["image"])
    text_vector = _embed_text(payload.get("text_blob") or payload.get("name", ""))
    discount_value = payload.get("discount_percentage")
    if discount_value in ("", None):
        discount_value = None
    else:
        discount_value = float(discount_value)
    point = models.PointStruct(
        id=f"product:{payload['product_id']}",
        vector={
            "image": image_vector.tolist(),
            "text": text_vector.tolist(),
        },
        payload={
            "source": "admin_upload",
            "product_id": str(payload["product_id"]),
            "name": payload.get("name", ""),
            "main_category": payload.get("main_category", ""),
            "sub_category": payload.get("sub_category", ""),
            "link": payload.get("link", ""),
            "image_local": payload.get("image_local", ""),
            "ratings": float(payload.get("ratings", 0) or 0),
            "no_of_ratings": float(payload.get("no_of_ratings", 0) or 0),
            "discount_price_usd": float(payload.get("discount_price_usd", 0) or 0),
            "actual_price_usd": float(payload.get("actual_price_usd", 0) or 0),
            "discount_percentage": discount_value,
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
            elif cmd == "search-text":
                result = _search_text(req["query"], int(req.get("top_k", 12)))
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
