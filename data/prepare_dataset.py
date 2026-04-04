import csv
import os
import random
import urllib.request
import urllib.error
import re

INPUT_CSV = "Amazon-Products-Final.csv"
OUTPUT_CSV = "Amazon-Products-100.csv"
IMAGES_DIR = "product_images"

os.makedirs(IMAGES_DIR, exist_ok=True)

# Read all rows
with open(INPUT_CSV, newline="", encoding="utf-8") as f:
    reader = csv.DictReader(f)
    rows = list(reader)

print(f"Total products: {len(rows)}")

# Pick 100 random products
random.seed(42)
sample = random.sample(rows, 100)


def safe_filename(name, idx):
    name = re.sub(r'[\\/*?:"<>|]', "", name)
    name = name.strip().replace(" ", "_")[:60]
    return f"{idx}_{name}.jpg"


downloaded = 0
failed = 0

output_rows = []
for i, row in enumerate(sample):
    img_url = row.get("image", "").strip()
    local_path = ""

    if img_url:
        filename = safe_filename(row["name"], i)
        local_path = os.path.join(IMAGES_DIR, filename)
        try:
            req = urllib.request.Request(img_url, headers={"User-Agent": "Mozilla/5.0"})
            with urllib.request.urlopen(req, timeout=10) as resp:
                with open(local_path, "wb") as out:
                    out.write(resp.read())
            downloaded += 1
            print(f"[{i+1}/100] Downloaded: {filename}")
        except (urllib.error.URLError, Exception) as e:
            print(f"[{i+1}/100] FAILED ({img_url}): {e}")
            local_path = ""
            failed += 1
    else:
        print(f"[{i+1}/100] No image URL for: {row['name'][:60]}")
        failed += 1

    output_row = {
        "name": row["name"],
        "main_category": row["main_category"],
        "sub_category": row["sub_category"],
        "image_url": img_url,
        "image_local": local_path,
        "link": row.get("link", ""),
        "ratings": row.get("ratings", ""),
        "no_of_ratings": row.get("no_of_ratings", ""),
        "description": row.get("description", ""),
        "discount_price_usd": row.get("discount_price_usd", ""),
        "actual_price_usd": row.get("actual_price_usd", ""),
    }
    output_rows.append(output_row)

# Write output CSV
fieldnames = list(output_rows[0].keys())
with open(OUTPUT_CSV, "w", newline="", encoding="utf-8") as f:
    writer = csv.DictWriter(f, fieldnames=fieldnames)
    writer.writeheader()
    writer.writerows(output_rows)

print(f"\nDone. Downloaded: {downloaded}, Failed: {failed}")
print(f"Output CSV: {OUTPUT_CSV}")
print(f"Images folder: {IMAGES_DIR}/")
