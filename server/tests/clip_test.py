from PIL import Image
import requests
from typing import List
from pathlib import Path
import os
from glob import glob

from sentence_transformers import SentenceTransformer
from transformers import CLIPProcessor
import faiss
import numpy as np

PROJECT_ROOT = Path(__file__).parent.parent.parent
IMAGES_PATH = PROJECT_ROOT / "img"


class CLIPmbeddings:
    def __init__(self):
        print("开始加载 Embedding 模型...")
        candidate_dirs = [
            PROJECT_ROOT / "meta" / "embedding" / "clip-Vit-32B-multilingual",
            PROJECT_ROOT / "meta" / "embedding" / "clip",
        ]
        embedding_root = candidate_dirs[0]
        for candidate in candidate_dirs:
            if candidate.exists():
                embedding_root = candidate
                break
        self.model = SentenceTransformer(str(embedding_root))
        # self.model.processor = CLIPProcessor.from_pretrained(
        #     str(EMBEDDING_MODEL_DIR), use_fast=True
        # )

    def encode_image(self, path: str) -> List[float]:
        image = Image.open(path)
        return self.model.encode(image)

    def encode_image_url(self, url: str) -> List[float]:
        image = Image.open(requests.get(url, stream=True).raw)
        return self.model.encode(image)


def generate_clip_embeddings(images_path, model):

    image_paths = glob(os.path.join(images_path, "**/*.jpg"), recursive=True)

    embeddings = []
    for img_path in image_paths:
        image = Image.open(img_path)
        embedding = model.encode(image)
        embeddings.append(embedding)

    return embeddings, image_paths


def create_faiss_index(embeddings, image_paths, output_path):

    dimension = len(embeddings[0])
    index = faiss.IndexFlatIP(dimension)
    index = faiss.IndexIDMap(index)

    vectors = np.array(embeddings).astype(np.float32)

    # Add vectors to the index with IDs
    index.add_with_ids(vectors, np.array(range(len(embeddings))))

    # Save the index
    faiss.write_index(index, output_path)
    print(f"Index created and saved to {output_path}")

    # Save image paths
    with open(output_path + ".paths", "w") as f:
        for img_path in image_paths:
            f.write(img_path + "\n")

    return index


def load_faiss_index(index_path):
    index = faiss.read_index(index_path)
    with open(index_path + ".paths", "r") as f:
        image_paths = [line.strip() for line in f]
    print(f"Index loaded from {index_path}")
    return index, image_paths


def retrieve_similar_images(query, model, index, image_paths, top_k=3):

    # query preprocess:
    if query.endswith((".png", ".jpg", ".jpeg", ".tiff", ".bmp", ".gif")):
        query = Image.open(query)

    query_features = model.encode(query)
    query_features = query_features.astype(np.float32).reshape(1, -1)

    distances, indices = index.search(query_features, top_k)

    retrieved_images = [image_paths[int(idx)] for idx in indices[0]]

    return query, retrieved_images


# index, image_paths = load_faiss_index(OUTPUT_INDEX_PATH)


# OUTPUT_INDEX_PATH = "/content/vector.index"
# index = create_faiss_index(embeddings, image_paths, OUTPUT_INDEX_PATH)

if __name__ == "__main__":
    model = CLIPmbeddings()
    url = "http://images.cocodataset.org/val2017/000000039769.jpg"
    image = Image.open(requests.get(url, stream=True).raw)
    embeddings, image_paths = generate_clip_embeddings(IMAGES_PATH, model)
