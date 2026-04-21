import os
import sys
import json
from dotenv import load_dotenv

# Force environment overrides if needed
load_dotenv()

try:
    import numpy as np
    import pandas as pd
    from FlagEmbedding import BGEM3FlagModel
    from qdrant_client import QdrantClient, models
    import pymongo
except ImportError as e:
    print(f"Skipping import error: {e}")

def main():
    MONGO_URI = os.environ.get("MONGO_URI", "mongodb+srv://user:pass@cluster.mongodb.net/omnifind")
    QDRANT_PATH = "data/qdrant_local_db"
    TEXT_COLLECTION = "omni_products_text"

    print("Connecting to MongoDB...")
    try:
        from pymongo import MongoClient
        client = MongoClient(MONGO_URI)
        db = client.get_database()
        collection = db['products']
        
        print("Fetching all products from database...")
        products = list(collection.find({}))
        print(f"Fetched {len(products)} products!")
    except Exception as e:
        print(f"MongoDB error: {e}. Are dependencies installed?")
        return

    # Extract text mapping exactly like Notebook
    texts = []
    docs = []
    for p in products:
        p_id = str(p['_id'])
        cat = str(p.get('main_category', '')).strip()
        name = str(p.get('name', '')).strip()
        desc = str(p.get('description', '')).strip()
        if desc.lower() == 'nan': desc = ''
        
        text = f"Category: {cat}. Product: {name}. Details: {desc}"
        texts.append(text)
        
        # Build payload matching the product model
        payload = {
            "product_id": p_id,
            "name": name,
            "main_category": cat,
            "sub_category": str(p.get("sub_category", "")),
            "image_url": str(p.get("image_url", "")),
            "image_local": str(p.get("image_local", "")),
            "link": str(p.get("link", "")),
            "description": desc,
            "ratings": float(p.get("ratings", 0)),
            "no_of_ratings": int(p.get("no_of_ratings", 0) if p.get("no_of_ratings") else 0),
            "discount_price_usd": float(p.get("discount_price_usd", 0)),
            "actual_price_usd": float(p.get("actual_price_usd", 0)),
            "discount_percentage": float(p.get("discount_percentage", 0)),
        }
        docs.append({"id": p_id, "text": text, "payload": payload})

    print("Booting BGE-M3 Model to memory (This may take a minute...)")
    try:
        model = BGEM3FlagModel('BAAI/bge-m3', use_fp16=True) # GPU optimized
    except Exception as e:
        print(f"Failed to load model: {e}")
        return

    print("Connecting to Qdrant Database...")
    q_client = QdrantClient(path=QDRANT_PATH)
    
    print(f"Recreating {TEXT_COLLECTION} collection...")
    try:
        q_client.delete_collection(TEXT_COLLECTION)
    except:
        pass
        
    q_client.create_collection(
        collection_name=TEXT_COLLECTION,
        vectors_config={"dense": models.VectorParams(size=1024, distance=models.Distance.COSINE)},
        sparse_vectors_config={"sparse": models.SparseVectorParams()}
    )

    BATCH_SIZE = 64
    all_points = []
    
    print(f"Encoding and Syncing {len(texts)} products to Qdrant...")
    for i in range(0, len(texts), BATCH_SIZE):
        batch_docs = docs[i:i+BATCH_SIZE]
        batch_texts = texts[i:i+BATCH_SIZE]
        
        output = model.encode(
            batch_texts,
            max_length=512,
            return_dense=True,
            return_sparse=True,
            return_colbert_vecs=False,
        )
        
        dense_vecs = output['dense_vecs']
        sparse_vecs = output['lexical_weights']
        
        points = []
        for j, doc in enumerate(batch_docs):
            import uuid
            uid = str(uuid.uuid5(uuid.NAMESPACE_OID, doc["id"]))
            
            sparse_dict = sparse_vecs[j]
            if isinstance(sparse_dict, dict):
                indices = [int(k) for k in sparse_dict.keys()]
                values = [float(v) for v in sparse_dict.values()]
            else:
                indices, values = [], []
                
            if len(indices) == 0:
                indices = [0]
                values = [0.0]

            points.append(models.PointStruct(
                id=uid,
                vector={
                    "dense": dense_vecs[j].tolist(),
                    "sparse": models.SparseVector(indices=indices, values=values)
                },
                payload=doc['payload']
            ))
            
        try:
            q_client.upsert(collection_name=TEXT_COLLECTION, points=points)
            print(f"Indexed {i + len(points)} / {len(texts)} products...")
        except Exception as e:
            print(f"Upsert failed for batch: {e}")

    print("FULL DATABASE SYNC COMPLETE!")
    print("You can now safely run 'npm run dev' and get incredibly fast semantic searches!")

if __name__ == "__main__":
    main()
