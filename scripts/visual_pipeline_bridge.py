import argparse
import os
import json

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

_MODEL = None
_PRE = None
_DEVICE = "cuda" if torch.cuda.is_available() else "cpu"


def _client() -> QdrantClient:
    if QDRANT_URL:
        return QdrantClient(url=QDRANT_URL, api_key=QDRANT_API_KEY or None, timeout=30.0)
    os.makedirs(QDRANT_LOCAL_PATH, exist_ok=True)
    return QdrantClient(path=QDRANT_LOCAL_PATH)


def _ensure_model():
    global _MODEL, _PRE
    if _MODEL is None:
        _MODEL = torch.hub.load("facebookresearch/dinov2", "dinov2_vits14")
        _MODEL.to(_DEVICE)
        _MODEL.eval()
        _PRE = transforms.Compose(
            [
                transforms.Resize(256),
                transforms.CenterCrop(224),
                transforms.ToTensor(),
                transforms.Normalize(mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225]),
            ]
        )


def _embed_image(image_path: str) -> np.ndarray:
    _ensure_model()
    with Image.open(image_path).convert("RGB") as img:
        x = _PRE(img).unsqueeze(0).to(_DEVICE)
    with torch.no_grad():
        feat = _MODEL(x)
        feat = feat / feat.norm(dim=-1, keepdim=True)
    return feat.squeeze(0).detach().cpu().numpy().astype("float32")


def _create_or_reset_collection(client: QdrantClient, vector_dim: int):
    collections = {c.name for c in client.get_collections().collections}
    if QDRANT_COLLECTION in collections:
        client.delete_collection(collection_name=QDRANT_COLLECTION)
    client.create_collection(
        collection_name=QDRANT_COLLECTION,
        vectors_config=models.VectorParams(
            size=vector_dim,
            distance=models.Distance.COSINE,
        ),
    )


def sync_pipeline(force: bool = False):
    if not os.path.exists(VISUAL_CSV_PATH):
        raise RuntimeError(f"Missing visual CSV: {VISUAL_CSV_PATH}")
    if not os.path.exists(VISUAL_EMB_PATH):
        raise RuntimeError(f"Missing visual embeddings: {VISUAL_EMB_PATH}")

    df = pd.read_csv(VISUAL_CSV_PATH)
    emb = np.load(VISUAL_EMB_PATH).astype("float32")
    if len(df) != len(emb):
        raise RuntimeError(f"CSV rows ({len(df)}) and embeddings ({len(emb)}) mismatch.")

    client = _client()
    collections = {c.name for c in client.get_collections().collections}
    existing_count = 0
    if QDRANT_COLLECTION in collections:
        existing_count = int(client.count(collection_name=QDRANT_COLLECTION, exact=True).count)
    if not force and existing_count == len(df):
        return {"synced": False, "count": existing_count, "collection": QDRANT_COLLECTION}

    _create_or_reset_collection(client, int(emb.shape[1]))
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
        client.upsert(collection_name=QDRANT_COLLECTION, points=points)

    return {"synced": True, "count": len(df), "collection": QDRANT_COLLECTION}


def search(image_path: str, top_k: int):
    if not os.path.exists(image_path):
        raise RuntimeError(f"Missing query image: {image_path}")
    sync_pipeline(force=False)
    client = _client()
    query = _embed_image(image_path)
    points = client.query_points(
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


def upsert_product(args):
    if not os.path.exists(args.image):
        raise RuntimeError(f"Missing uploaded image: {args.image}")
    sync_pipeline(force=False)
    client = _client()
    vector = _embed_image(args.image)
    point = models.PointStruct(
        id=f"product:{args.product_id}",
        vector=vector.tolist(),
        payload={
            "source": "admin_upload",
            "product_id": str(args.product_id),
            "name": args.name,
            "main_category": args.main_category,
            "sub_category": args.sub_category,
            "link": args.link,
            "image_local": args.image_local,
        },
    )
    client.upsert(collection_name=QDRANT_COLLECTION, points=[point])
    return {"upserted": True, "id": f"product:{args.product_id}"}


def delete_product(product_id: str):
    sync_pipeline(force=False)
    client = _client()
    client.delete(
        collection_name=QDRANT_COLLECTION,
        points_selector=models.PointIdsList(points=[f"product:{product_id}"]),
    )
    return {"deleted": True, "id": f"product:{product_id}"}


def _build_parser():
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="cmd", required=True)

    s_sync = sub.add_parser("sync-pipeline")
    s_sync.add_argument("--force", action="store_true")

    s_search = sub.add_parser("search")
    s_search.add_argument("--image", required=True)
    s_search.add_argument("--top-k", type=int, default=12)

    s_upsert = sub.add_parser("upsert-product")
    s_upsert.add_argument("--product-id", required=True)
    s_upsert.add_argument("--name", default="")
    s_upsert.add_argument("--main-category", default="")
    s_upsert.add_argument("--sub-category", default="")
    s_upsert.add_argument("--link", default="")
    s_upsert.add_argument("--image-local", default="")
    s_upsert.add_argument("--image", required=True)

    s_delete = sub.add_parser("delete-product")
    s_delete.add_argument("--product-id", required=True)

    return parser


def main():
    parser = _build_parser()
    args = parser.parse_args()
    if args.cmd == "sync-pipeline":
        print(json.dumps(sync_pipeline(force=args.force)))
        return
    if args.cmd == "search":
        print(json.dumps(search(args.image, args.top_k)))
        return
    if args.cmd == "upsert-product":
        print(json.dumps(upsert_product(args)))
        return
    if args.cmd == "delete-product":
        print(json.dumps(delete_product(args.product_id)))
        return
    raise RuntimeError("Unknown command")


if __name__ == "__main__":
    main()
