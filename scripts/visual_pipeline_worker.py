import json
import math
import os
import re
import sys
import uuid
from typing import Dict, List, Tuple

import numpy as np
import pandas as pd
import torch
from PIL import Image
from qdrant_client import QdrantClient
from qdrant_client.http import models
from torchvision import transforms

try:
    from sklearn.feature_extraction.text import HashingVectorizer

    SKLEARN_AVAILABLE = True
except Exception:
    HashingVectorizer = None
    SKLEARN_AVAILABLE = False

try:
    from FlagEmbedding import BGEM3FlagModel, FlagReranker

    BGE_AVAILABLE = True
    BGE_IMPORT_ERROR = ""
except Exception as bge_import_error:
    BGEM3FlagModel = None
    FlagReranker = None
    BGE_AVAILABLE = False
    BGE_IMPORT_ERROR = str(bge_import_error)

try:
    from transformers import pipeline

    TRANSFORMERS_AVAILABLE = True
except Exception:
    pipeline = None
    TRANSFORMERS_AVAILABLE = False


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
QDRANT_URL = os.environ.get("QDRANT_URL", "")
QDRANT_API_KEY = os.environ.get("QDRANT_API_KEY", "")

VISUAL_COLLECTION = os.environ.get("QDRANT_COLLECTION", "amazon_visual_dino")
TEXT_COLLECTION = os.environ.get("QDRANT_TEXT_COLLECTION", "omni_products")
TEXT_ENCODER_MODE = os.environ.get("QDRANT_TEXT_ENCODER", "bge").strip().lower()
TEXT_BATCH_SIZE = max(8, int(os.environ.get("QDRANT_TEXT_BATCH_SIZE", "16")))
HASH_N_FEATURES = max(4096, int(os.environ.get("QDRANT_TEXT_HASH_FEATURES", "32768")))
HASH_DENSE_DIM = max(64, int(os.environ.get("QDRANT_TEXT_HASH_DENSE_DIM", "256")))
HASH_SEED = int(os.environ.get("QDRANT_TEXT_HASH_SEED", "42"))
TEXT_INTENT_MODE = os.environ.get("OMNIFIND_TEXT_INTENT_MODE", "llm").strip().lower()
TEXT_LLM_MODEL = os.environ.get("OMNIFIND_TEXT_LLM_MODEL", "Qwen/Qwen2.5-3B-Instruct").strip()

DEVICE = "cuda" if torch.cuda.is_available() else "cpu"
TEXT_DEVICE = os.environ.get("OMNIFIND_TEXT_DEVICE", "cpu").strip().lower()
INTENT_DEVICE = os.environ.get("OMNIFIND_INTENT_DEVICE", TEXT_DEVICE).strip().lower()
TEXT_USE_CUDA = TEXT_DEVICE == "cuda" and torch.cuda.is_available()
INTENT_USE_CUDA = INTENT_DEVICE == "cuda" and torch.cuda.is_available()


def _emit(payload):
    sys.stdout.write(json.dumps(payload) + "\n")
    sys.stdout.flush()


def _product_point_id(product_id: str, namespace: str) -> str:
    """Generate a deterministic UUID for a product in a given namespace."""
    return str(uuid.uuid5(uuid.NAMESPACE_URL, f"{namespace}:{product_id}"))


def _client() -> QdrantClient:
    if QDRANT_URL:
        return QdrantClient(url=QDRANT_URL, api_key=QDRANT_API_KEY or None, timeout=30.0)
    os.makedirs(QDRANT_LOCAL_PATH, exist_ok=True)
    return QdrantClient(path=QDRANT_LOCAL_PATH)


CLIENT = _client()


# -----------------------------
# Visual embedding pipeline
# -----------------------------
VISUAL_MODEL = None
VISUAL_PREPROCESS = None


def _ensure_visual_model():
    global VISUAL_MODEL, VISUAL_PREPROCESS
    if VISUAL_MODEL is not None and VISUAL_PREPROCESS is not None:
        return
    VISUAL_MODEL = torch.hub.load("facebookresearch/dinov2", "dinov2_vits14")
    VISUAL_MODEL.to(DEVICE)
    VISUAL_MODEL.eval()
    VISUAL_PREPROCESS = transforms.Compose(
        [
            transforms.Resize(256),
            transforms.CenterCrop(224),
            transforms.ToTensor(),
            transforms.Normalize(mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225]),
        ]
    )


def _embed_image(image_path: str) -> np.ndarray:
    _ensure_visual_model()
    with Image.open(image_path).convert("RGB") as img:
        x = VISUAL_PREPROCESS(img).unsqueeze(0).to(DEVICE)
    with torch.no_grad():
        feat = VISUAL_MODEL(x)
        feat = feat / feat.norm(dim=-1, keepdim=True)
    return feat.squeeze(0).detach().cpu().numpy().astype("float32")


def _sync_pipeline(force: bool = False):
    if not os.path.exists(VISUAL_CSV_PATH):
        raise RuntimeError(f"Missing visual CSV: {VISUAL_CSV_PATH}")
    if not os.path.exists(VISUAL_EMB_PATH):
        raise RuntimeError(f"Missing visual embeddings: {VISUAL_EMB_PATH}")

    df = pd.read_csv(VISUAL_CSV_PATH)
    emb = np.load(VISUAL_EMB_PATH).astype("float32")
    if len(df) != len(emb):
        raise RuntimeError(f"CSV rows ({len(df)}) and embeddings ({len(emb)}) mismatch.")

    collections = {c.name for c in CLIENT.get_collections().collections}
    existing_count = 0
    if VISUAL_COLLECTION in collections:
        existing_count = int(CLIENT.count(collection_name=VISUAL_COLLECTION, exact=True).count)
    if not force and existing_count == len(df):
        return {
            "synced": False,
            "count": existing_count,
            "collection": VISUAL_COLLECTION,
        }

    if VISUAL_COLLECTION in collections:
        CLIENT.delete_collection(collection_name=VISUAL_COLLECTION)

    CLIENT.create_collection(
        collection_name=VISUAL_COLLECTION,
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
        CLIENT.upsert(collection_name=VISUAL_COLLECTION, points=points)

    return {
        "synced": True,
        "count": len(df),
        "collection": VISUAL_COLLECTION,
    }


def _search_visual(image_path: str, top_k: int):
    query = _embed_image(image_path)
    points = CLIENT.query_points(
        collection_name=VISUAL_COLLECTION,
        query=query.tolist(),
        limit=max(1, top_k),
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


def _upsert_visual_product(payload):
    product_id = str(payload["product_id"])
    vector = _embed_image(payload["image"])
    point_id = _product_point_id(product_id, "visual")
    point = models.PointStruct(
        id=point_id,
        vector=vector.tolist(),
        payload={
            "source": "admin_upload",
            "product_id": product_id,
            "name": payload.get("name", ""),
            "main_category": payload.get("main_category", ""),
            "sub_category": payload.get("sub_category", ""),
            "link": payload.get("link", ""),
            "image_local": payload.get("image_local", ""),
        },
    )
    CLIENT.upsert(collection_name=VISUAL_COLLECTION, points=[point])
    return {"upserted": True, "id": point_id}


def _delete_visual_product(product_id):
    point_id = _product_point_id(str(product_id), "visual")
    CLIENT.delete(
        collection_name=VISUAL_COLLECTION,
        points_selector=models.PointIdsList(points=[point_id]),
    )
    return {"deleted": True, "id": point_id}


# ─────────────────────────────────────────────────
# Text embedding pipeline (from OmniFind V2 notebook)
#
# Implements hybrid semantic search using:
#   - BGE-M3 model for dense (1024-dim) + sparse vectors
#   - Fallback to sklearn HashingVectorizer if BGE unavailable
#   - RRF (Reciprocal Rank Fusion) for hybrid retrieval
#   - Regex-based intent parsing (price, rating, deal, exclusion)
#   - Business-logic score boosting (discount % + ratings)
# ─────────────────────────────────────────────────
class SemanticCache:
    def __init__(self, similarity_threshold=0.98):
        self.cache = []
        self.threshold = similarity_threshold

    def search(self, query_vec, query_filter_str):
        if not self.cache:
            return None

        cache_vecs = np.array([item['vector'] for item in self.cache])
        query_vec_np = np.array(query_vec)

        dots = np.dot(cache_vecs, query_vec_np)
        norms = np.linalg.norm(cache_vecs, axis=1) * np.linalg.norm(query_vec_np)
        sims = dots / (norms + 1e-10)

        best_idx = np.argmax(sims)

        if sims[best_idx] >= self.threshold and self.cache[best_idx].get('filter') == str(query_filter_str):
            sys.stderr.write(f"⚡ CACHE HIT! Similarity: {sims[best_idx]:.4f}\n")
            sys.stderr.flush()
            return self.cache[best_idx]['results']

        return None

    def add(self, query_vec, results, query_filter_str):
        self.cache.append({
            'vector': query_vec,
            'results': results,
            'filter': str(query_filter_str)
        })

TEXT_STATE = {
    "backend": None,
    "model": None,
    "reranker": None,
    "llm_pipeline": None,
    "cache": None,
    "hash_vectorizer": None,
    "hash_projection": None,
}


def _safe_str(value) -> str:
    if value is None:
        return ""
    text = str(value)
    if text.lower() == "nan":
        return ""
    return text.strip()


def _safe_float(value, default=0.0) -> float:
    if value is None:
        return default if default is None else float(default)
    try:
        text = str(value).replace(",", "").strip()
        if text == "":
            return default if default is None else float(default)
        return float(text)
    except Exception:
        return default if default is None else float(default)


def _normalize_rows(arr: np.ndarray) -> np.ndarray:
    norms = np.linalg.norm(arr, axis=1, keepdims=True)
    norms[norms == 0] = 1.0
    return (arr / norms).astype("float32")


def _sparse_row_to_indices_values(row) -> Tuple[List[int], List[float]]:
    row = row.tocoo()
    if row.nnz == 0:
        return [0], [0.0]
    return row.col.astype(int).tolist(), row.data.astype(float).tolist()


def _choose_text_backend() -> str:
    if TEXT_ENCODER_MODE == "hash":
        if not SKLEARN_AVAILABLE:
            raise RuntimeError("QDRANT_TEXT_ENCODER=hash requires scikit-learn to be installed.")
        return "hash"

    if TEXT_ENCODER_MODE == "bge":
        if not BGE_AVAILABLE:
            raise RuntimeError(
                "QDRANT_TEXT_ENCODER=bge requires FlagEmbedding. Import failed in DINO_PYTHON_BIN: "
                f"{BGE_IMPORT_ERROR or 'unknown import error'}"
            )
        return "bge"

    # auto mode: prefer BGE only when CUDA is active; otherwise use hash backend for
    # significantly lower RAM/CPU pressure on laptop environments.
    if BGE_AVAILABLE and TEXT_USE_CUDA:
        return "bge"
    if SKLEARN_AVAILABLE:
        return "hash"
    if BGE_AVAILABLE:
        return "bge"

    raise RuntimeError(
        "No text encoder backend available. Install FlagEmbedding or scikit-learn."
    )


def _init_text_backend() -> str:
    if TEXT_STATE["backend"]:
        return TEXT_STATE["backend"]

    backend = _choose_text_backend()
    if backend == "bge":
        model = BGEM3FlagModel("BAAI/bge-m3", use_fp16=TEXT_USE_CUDA)
        TEXT_STATE["model"] = model

        sys.stderr.write(f"Booting BGE-Reranker on {'cuda' if TEXT_USE_CUDA else 'cpu'}...\n")
        sys.stderr.flush()
        if FlagReranker is not None:
            TEXT_STATE["reranker"] = FlagReranker("BAAI/bge-reranker-v2-m3", use_fp16=TEXT_USE_CUDA)

        TEXT_STATE["cache"] = SemanticCache(similarity_threshold=0.98)

        if TEXT_INTENT_MODE == "llm":
            if not TRANSFORMERS_AVAILABLE or pipeline is None:
                raise RuntimeError(
                    "LLM intent mode requires transformers pipeline. "
                    "Install transformers or set OMNIFIND_TEXT_INTENT_MODE=regex."
                )

            sys.stderr.write(f"Initializing Offline LLM Intent Parser ({TEXT_LLM_MODEL})...\n")
            sys.stderr.flush()
            generation_device_map = "auto" if INTENT_USE_CUDA else "cpu"
            generation_dtype = torch.float16 if INTENT_USE_CUDA else torch.float32
            TEXT_STATE["llm_pipeline"] = pipeline(
                "text-generation",
                model=TEXT_LLM_MODEL,
                torch_dtype=generation_dtype,
                device_map=generation_device_map,
            )

    elif backend == "hash":
        vectorizer = HashingVectorizer(
            n_features=HASH_N_FEATURES,
            alternate_sign=False,
            norm="l2",
            ngram_range=(1, 2),
            token_pattern=r"(?u)\b\w+\b",
        )
        rng = np.random.default_rng(HASH_SEED)
        projection = rng.standard_normal((HASH_N_FEATURES, HASH_DENSE_DIM), dtype=np.float32)
        projection /= math.sqrt(float(HASH_DENSE_DIM))
        TEXT_STATE["hash_vectorizer"] = vectorizer
        TEXT_STATE["hash_projection"] = projection

    TEXT_STATE["backend"] = backend
    return backend


def _encode_texts(texts: List[str]) -> Tuple[np.ndarray, List[Dict[str, List[float]]], str]:
    """Encode texts into dense + sparse vectors using the active backend."""
    backend = _init_text_backend()

    if backend == "bge":
        model = TEXT_STATE["model"]
        dense_parts: List[np.ndarray] = []
        sparse_items: List[Dict[str, List[float]]] = []

        for start in range(0, len(texts), TEXT_BATCH_SIZE):
            batch = texts[start : start + TEXT_BATCH_SIZE]
            output = model.encode(
                batch,
                max_length=512,
                return_dense=True,
                return_sparse=True,
                return_colbert_vecs=False,
            )
            dense_batch = np.asarray(output.get("dense_vecs", []), dtype="float32")
            if dense_batch.ndim == 1:
                dense_batch = dense_batch.reshape(1, -1)
            dense_parts.append(dense_batch)

            for sparse_dict in output.get("lexical_weights", []):
                if isinstance(sparse_dict, dict):
                    indices = [int(k) for k in sparse_dict.keys()]
                    values = [float(v) for v in sparse_dict.values()]
                else:
                    indices = [int(item[0]) for item in sparse_dict]
                    values = [float(item[1]) for item in sparse_dict]
                if not indices:
                    indices, values = [0], [0.0]
                sparse_items.append({"indices": indices, "values": values})

        dense = np.vstack(dense_parts).astype("float32")
        dense = _normalize_rows(dense)
        return dense, sparse_items, backend

    # Hash fallback
    vectorizer = TEXT_STATE["hash_vectorizer"]
    projection = TEXT_STATE["hash_projection"]
    sparse_matrix = vectorizer.transform(texts)
    dense = sparse_matrix @ projection
    dense = np.asarray(dense, dtype="float32")
    dense = _normalize_rows(dense)

    sparse_items = []
    for i in range(sparse_matrix.shape[0]):
        indices, values = _sparse_row_to_indices_values(sparse_matrix.getrow(i))
        sparse_items.append({"indices": indices, "values": values})

    return dense, sparse_items, backend


def _build_text_doc(product: Dict[str, object]) -> Dict[str, object]:
    """Build a Qdrant-ready document from a product dict."""
    product_id = _safe_str(product.get("product_id") or product.get("_id"))
    if not product_id:
        return {}

    name = _safe_str(product.get("name"))
    main_category = _safe_str(product.get("main_category"))
    sub_category = _safe_str(product.get("sub_category"))
    description = _safe_str(product.get("description"))
    link = _safe_str(product.get("link"))
    image_local = _safe_str(product.get("image_local"))
    image_url = _safe_str(product.get("image_url"))

    discount_price = _safe_float(product.get("discount_price_usd"), 0.0)
    actual_price = _safe_float(product.get("actual_price_usd"), 0.0)
    ratings = _safe_float(product.get("ratings"), 0.0)
    no_of_ratings = _safe_float(product.get("no_of_ratings"), 0.0)

    discount_percentage = _safe_float(product.get("discount_percentage"), 0.0)
    if discount_percentage <= 0 and actual_price > 0:
        discount_percentage = max(0.0, (actual_price - discount_price) / actual_price)

    # Composite text for embedding — matches notebook pattern:
    # "{category}: {name}. {description}"
    text = f"{main_category}: {name}. {description}".strip()

    return {
        "id": _product_point_id(product_id, "text"),
        "text": text,
        "payload": {
            "source": "text_index",
            "product_id": product_id,
            "name": name,
            "name_norm": name.lower(),
            "main_category": main_category,
            "main_category_norm": main_category.lower(),
            "sub_category": sub_category,
            "sub_category_norm": sub_category.lower(),
            "description": description,
            "discount_price_usd": float(discount_price),
            "actual_price_usd": float(actual_price),
            "discount_percentage": float(discount_percentage),
            "ratings": float(ratings),
            "no_of_ratings": float(no_of_ratings),
            "link": link,
            "image_local": image_local,
            "image_url": image_url,
        },
    }


def _build_text_filter(params: Dict[str, object]):
    """Build a Qdrant filter from intent + explicit params."""
    must = []
    must_not = []

    min_price = _safe_float(params.get("min_price"), None)
    max_price = _safe_float(params.get("max_price"), None)
    min_rating = _safe_float(params.get("min_rating"), None)

    if min_price is not None:
        must.append(
            models.FieldCondition(
                key="discount_price_usd",
                range=models.Range(gte=float(min_price)),
            )
        )
    if max_price is not None:
        must.append(
            models.FieldCondition(
                key="discount_price_usd",
                range=models.Range(lte=float(max_price)),
            )
        )
    if min_rating is not None:
        must.append(
            models.FieldCondition(
                key="ratings",
                range=models.Range(gte=float(min_rating)),
            )
        )
    if params.get("deal_seeker"):
        must.append(
            models.FieldCondition(
                key="discount_percentage",
                range=models.Range(gte=0.20),
            )
        )

    category = _safe_str(params.get("category")).lower()
    sub_category = _safe_str(params.get("sub_category")).lower()
    if category:
        must.append(
            models.FieldCondition(
                key="main_category_norm",
                match=models.MatchText(text=category),
            )
        )
    if sub_category:
        must.append(
            models.FieldCondition(
                key="sub_category_norm",
                match=models.MatchText(text=sub_category),
            )
        )

    for phrase in params.get("must_not", []):
        term = _safe_str(phrase).lower()
        if not term:
            continue
        must_not.append(
            models.FieldCondition(
                key="name",
                match=models.MatchText(text=term),
            )
        )

    if not must and not must_not:
        return None
    return models.Filter(must=must or None, must_not=must_not or None)


def _parse_intent(query: str) -> Dict[str, object]:
    query_text = _safe_str(query)
    query_lower = query_text.lower()

    max_price = None
    min_price = None
    price_matches = [float(v) for v in re.findall(r"(?<!\w)(?:\$|usd\s*)?(\d+(?:\.\d+)?)", query_lower)]
    under_matches = re.findall(r"(?:under|below|less than|max(?:imum)?|upto|up to)\s*(?:\$|usd\s*)?(\d+(?:\.\d+)?)", query_lower)
    over_matches = re.findall(r"(?:over|above|more than|min(?:imum)?|at least)\s*(?:\$|usd\s*)?(\d+(?:\.\d+)?)", query_lower)
    between_matches = re.findall(
        r"(?:between|from)\s*(?:\$|usd\s*)?(\d+(?:\.\d+)?)\s*(?:and|to|-)\s*(?:\$|usd\s*)?(\d+(?:\.\d+)?)",
        query_lower,
    )
    if between_matches:
        lo, hi = between_matches[0]
        min_price = float(lo)
        max_price = float(hi)
        if min_price > max_price:
            min_price, max_price = max_price, min_price
    elif under_matches:
        max_price = float(under_matches[0])
    elif over_matches:
        min_price = float(over_matches[0])
    elif len(price_matches) == 1:
        max_price = price_matches[0]

    min_rating = None
    rating_match = re.search(r"(\d(?:\.\d+)?)\s*(?:\+)?\s*(?:stars?|rating)", query_lower)
    if rating_match:
        min_rating = float(rating_match.group(1))
    elif re.search(r"\b(best|top|excellent|high(?:ly)?\s*rated)\b", query_lower):
        min_rating = 4.0

    deal_seeker = bool(re.search(r"\b(cheap|sale|discount|bargain|deal|budget|affordable)\b", query_lower))

    product_keywords = {
        "iphone",
        "phone",
        "smartphone",
        "laptop",
        "tv",
        "television",
        "ac",
        "air conditioner",
        "tablet",
        "monitor",
        "headphone",
        "earbuds",
    }
    accessory_keywords = {
        "case",
        "cover",
        "charger",
        "cable",
        "stand",
        "mount",
        "protector",
        "remote",
        "adapter",
    }
    wants_main_product = any(keyword in query_lower for keyword in product_keywords)
    searching_accessory = any(keyword in query_lower for keyword in accessory_keywords)
    must_not = []
    if wants_main_product and not searching_accessory:
        must_not = ["case", "cover", "charger", "cable", "stand", "mount", "protector", "remote"]

    clean_query = re.sub(
        r"\b(under|below|less than|over|above|more than|between|from|to|and|cheap|sale|discount|bargain|deal|budget|affordable|best|top|excellent|highly rated)\b",
        " ",
        query_text,
        flags=re.IGNORECASE,
    )
    clean_query = re.sub(r"\s+", " ", clean_query).strip() or query_text

    fallback_intent = {
        "clean_query": clean_query,
        "query_rewrite": clean_query,
        "max_price": max_price,
        "min_price": min_price,
        "min_rating": min_rating,
        "deal_seeker": deal_seeker,
        "must_not": must_not,
        "attributes": {},
    }

    if TEXT_INTENT_MODE != "llm":
        return fallback_intent

    if not TEXT_STATE.get("llm_pipeline"):
        raise RuntimeError(
            "LLM intent mode requested but llm_pipeline is unavailable. "
            "Set OMNIFIND_TEXT_INTENT_MODE=regex or check model setup."
        )
    prompt = f"""You are an expert E-Commerce Intent Parser. Output ONLY valid JSON, no other text.

# Rules:
- clean_query: Core product search term. Fix typos, expand abbreviations (ac → air conditioner), remove filters/deals.
- query_rewrite: Improved version of clean_query for better embedding (add synonyms if helpful, e.g., "wireless earbuds" → "wireless headphones earbuds").
- max_price, min_price: floats or null.
- min_rating: 4.0 if "best/top/excellent/highly rated", else null.
- deal_seeker: true if mentions cheap/sale/discount/bargain/deal.
- must_not: ONLY if user wants main product (iphone, laptop, tv, ac) → block common accessories ["case","cover","charger","cable","stand","mount","protector","remote"]. Empty [] if searching for accessory itself.
- attributes: dict of extracted filters like {{"brand": "samsung", "color": "black"}} for future use.

Query: "{query}"

Output exactly this JSON:
{{
  "clean_query": "...",
  "query_rewrite": "...",
  "max_price": null,
  "min_price": null,
  "min_rating": null,
  "deal_seeker": false,
  "must_not": [],
  "attributes": {{}}
}}"""
    try:
        messages = [{"role": "user", "content": prompt}]
        output = TEXT_STATE["llm_pipeline"](messages, max_new_tokens=300, do_sample=True, temperature=0.1, top_p=0.95)
        generated_text = output[0]["generated_text"][-1]["content"]
        json_match = re.search(r"\{[\s\S]*\}", generated_text)
        if json_match:
            return json.loads(json_match.group(0))
        return json.loads(generated_text.strip())
    except Exception:
        return {
            **fallback_intent,
        }


def _ensure_text_collection(dense_dim: int, recreate: bool):
    """Create the text collection with dense + sparse vector config."""
    collections = {c.name for c in CLIENT.get_collections().collections}
    if recreate and TEXT_COLLECTION in collections:
        CLIENT.delete_collection(collection_name=TEXT_COLLECTION)
        collections.remove(TEXT_COLLECTION)

    if TEXT_COLLECTION not in collections:
        CLIENT.create_collection(
            collection_name=TEXT_COLLECTION,
            vectors_config={
                "dense": models.VectorParams(size=int(dense_dim), distance=models.Distance.COSINE),
            },
            sparse_vectors_config={
                "sparse": models.SparseVectorParams(),
            },
        )


def _sync_text_index(products: List[Dict[str, object]], force: bool = False):
    """Bulk sync all products into the text collection."""
    docs = []
    for product in products:
        doc = _build_text_doc(product)
        if doc:
            docs.append(doc)

    collections = {c.name for c in CLIENT.get_collections().collections}
    existing_count = 0
    if TEXT_COLLECTION in collections:
        existing_count = int(CLIENT.count(collection_name=TEXT_COLLECTION, exact=True).count)

    if not force and existing_count == len(docs) and len(docs) > 0:
        backend = _init_text_backend()
        return {
            "synced": False,
            "count": existing_count,
            "collection": TEXT_COLLECTION,
            "encoder": backend,
        }

    if len(docs) == 0:
        _ensure_text_collection(dense_dim=HASH_DENSE_DIM, recreate=True)
        return {
            "synced": True,
            "count": 0,
            "collection": TEXT_COLLECTION,
            "encoder": _init_text_backend(),
        }

    texts = [doc["text"] for doc in docs]
    dense, sparse_items, backend = _encode_texts(texts)

    _ensure_text_collection(dense_dim=int(dense.shape[1]), recreate=True)

    batch_size = 128
    for start in range(0, len(docs), batch_size):
        end = min(start + batch_size, len(docs))
        points = []
        for i in range(start, end):
            sparse_row = sparse_items[i]
            points.append(
                models.PointStruct(
                    id=docs[i]["id"],
                    vector={
                        "dense": dense[i].tolist(),
                        "sparse": models.SparseVector(
                            indices=sparse_row["indices"],
                            values=sparse_row["values"],
                        ),
                    },
                    payload=docs[i]["payload"],
                )
            )
        CLIENT.upsert(collection_name=TEXT_COLLECTION, points=points)

    return {
        "synced": True,
        "count": len(docs),
        "collection": TEXT_COLLECTION,
        "encoder": backend,
    }


def _sync_text_from_file(products_file: str, force: bool = False):
    """Load product list from a temp JSON file and sync."""
    if not products_file or not os.path.exists(products_file):
        raise RuntimeError(f"Missing products file: {products_file}")

    with open(products_file, "r", encoding="utf-8-sig") as fp:
        products = json.load(fp)

    if not isinstance(products, list):
        raise RuntimeError("products_file must contain a JSON array.")

    return _sync_text_index(products, force=force)


def _upsert_text_product(payload):
    """Add or update a single product's text vectors."""
    doc = _build_text_doc(payload)
    if not doc:
        raise RuntimeError("Missing product_id for text upsert.")

    dense, sparse_items, backend = _encode_texts([doc["text"]])
    _ensure_text_collection(dense_dim=int(dense.shape[1]), recreate=False)

    point = models.PointStruct(
        id=doc["id"],
        vector={
            "dense": dense[0].tolist(),
            "sparse": models.SparseVector(
                indices=sparse_items[0]["indices"],
                values=sparse_items[0]["values"],
            ),
        },
        payload=doc["payload"],
    )
    CLIENT.upsert(collection_name=TEXT_COLLECTION, points=[point])
    return {
        "upserted": True,
        "id": doc["id"],
        "collection": TEXT_COLLECTION,
        "encoder": backend,
    }


def _delete_text_product(product_id):
    """Remove a product from the text collection."""
    point_id = _product_point_id(str(product_id), "text")
    CLIENT.delete(
        collection_name=TEXT_COLLECTION,
        points_selector=models.PointIdsList(points=[point_id]),
    )
    return {"deleted": True, "id": point_id}


def _search_text(req):
    """
    Hybrid semantic search — mirrors the notebook's OmniFindPipeline.search():
      1. Parse intent (regex-based)
      2. Encode query with BGE-M3 (dense + sparse)
      3. RRF fusion of dense + sparse prefetch results
      4. Business-logic score boosting (discount + ratings)
    """
    query = _safe_str(req.get("query"))
    if not query:
        raise RuntimeError("Missing query")

    top_k = max(1, int(req.get("top_k", 5)))
    intent = _parse_intent(query)

    q_filter = _build_text_filter(
        {
            "max_price": intent.get("max_price"),
            "min_price": intent.get("min_price"),
            "min_rating": intent.get("min_rating"),
            "deal_seeker": intent.get("deal_seeker"),
            "must_not": intent.get("must_not") or [],
        }
    )

    # Ensure backend initialized for cache and reranker
    _init_text_backend()

    # Use the rewritten query for better semantic matching
    query_text = intent.get("query_rewrite") or intent.get("clean_query") or query
    dense, sparse_items, backend = _encode_texts([query_text])
    dense_vec = dense[0].tolist()
    sparse_vec = sparse_items[0]

    filter_str = str(intent)
    if TEXT_STATE.get("cache"):
        cached_results = TEXT_STATE["cache"].search(dense_vec, filter_str)
        if cached_results:
            return {
                "hits": cached_results[:top_k],
                "intent": intent,
                "collection": TEXT_COLLECTION,
                "encoder": backend,
                "cached": True,
            }

    # Hybrid retrieval: RRF fusion of dense + sparse prefetch
    if sparse_vec["indices"]:
        result = CLIENT.query_points(
            collection_name=TEXT_COLLECTION,
            prefetch=[
                models.Prefetch(
                    query=dense_vec,
                    using="dense",
                    filter=q_filter,
                    limit=60,
                ),
                models.Prefetch(
                    query=models.SparseVector(
                        indices=sparse_vec["indices"],
                        values=sparse_vec["values"],
                    ),
                    using="sparse",
                    filter=q_filter,
                    limit=60,
                ),
            ],
            query=models.FusionQuery(fusion=models.Fusion.RRF),
            query_filter=q_filter,
            limit=40,
            with_payload=True,
            with_vectors=False,
        )
    else:
        # Fallback to dense-only if no sparse vector produced
        result = CLIENT.query_points(
            collection_name=TEXT_COLLECTION,
            query=dense_vec,
            using="dense",
            query_filter=q_filter,
            limit=top_k,
            with_payload=True,
            with_vectors=False,
        )

    points = result.points if hasattr(result, "points") else result

    reranker = TEXT_STATE.get("reranker")
    if reranker and points:
        pairs = []
        for point in points:
            p = point.payload or {}
            # Match notebook style: "Category: {}. Product: {}. Details: {}"
            product_text = f"Category: {p.get('main_category', '')}. Product: {p.get('name', '')}. Details: {p.get('description', '')}"
            clean_q = intent.get("clean_query") or query
            pairs.append([clean_q, product_text])
            
        rerank_scores = reranker.compute_score(pairs, normalize=True)
        if isinstance(rerank_scores, float):
            rerank_scores = [rerank_scores]
    else:
        rerank_scores = [float(point.score) for point in points]

    # Business-logic score boosting (from notebook)
    boosted = []
    for idx, point in enumerate(points):
        payload = point.payload or {}
        score = float(rerank_scores[idx])

        discount_pct = _safe_float(payload.get("discount_percentage"), 0.0)
        ratings = max(0.0, _safe_float(payload.get("ratings"), 0.0))

        discount_mult = math.log1p(discount_pct) * 0.15
        rating_mult = math.log1p(ratings / 5.0) * 0.10
        business_boost = 1.0 + discount_mult + rating_mult
        
        score *= business_boost

        boosted.append(
            {
                "id": str(point.id),
                "score": float(score),
                "payload": payload,
            }
        )

    boosted.sort(key=lambda item: item["score"], reverse=True)

    if TEXT_STATE.get("cache"):
        TEXT_STATE["cache"].add(dense_vec, boosted, filter_str)

    return {
        "hits": boosted[:top_k],
        "intent": intent,
        "collection": TEXT_COLLECTION,
        "encoder": backend,
    }


# -----------------------------
# Main command loop
# -----------------------------
def main():
    _emit({"ready": True})

    warmup_raw = os.environ.get("OMNIFIND_VISUAL_WARMUP", "0").strip().lower()
    warmup_visual = warmup_raw in {"1", "true", "yes", "on"}
    if warmup_visual:
        try:
            _sync_pipeline(force=False)
        except Exception:
            # Startup should not fail entirely if visual dataset is unavailable.
            pass

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue

        req = None
        try:
            req = json.loads(line)
            cmd = req.get("cmd")
            req_id = req.get("id")

            if cmd == "sync-pipeline":
                result = _sync_pipeline(force=bool(req.get("force")))
            elif cmd == "search":
                result = _search_visual(req["image"], int(req.get("top_k", 12)))
            elif cmd == "upsert-product":
                result = _upsert_visual_product(req)
            elif cmd == "delete-product":
                result = _delete_visual_product(req["product_id"])
            elif cmd == "sync-text-index":
                result = _sync_text_from_file(
                    products_file=req.get("products_file", ""),
                    force=bool(req.get("force")),
                )
            elif cmd == "search-text":
                result = _search_text(req)
            elif cmd == "upsert-product-text":
                result = _upsert_text_product(req)
            elif cmd == "delete-product-text":
                result = _delete_text_product(req["product_id"])
            else:
                raise RuntimeError(f"Unknown command: {cmd}")

            _emit({"id": req_id, "ok": True, "result": result})
        except Exception as exc:
            _emit(
                {
                    "id": req.get("id") if isinstance(req, dict) else None,
                    "ok": False,
                    "error": str(exc),
                }
            )


if __name__ == "__main__":
    main()
