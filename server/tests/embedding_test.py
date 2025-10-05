from FlagEmbedding import BGEM3FlagModel, FlagReranker
from typing import List, Dict
from pathlib import Path

PROJECT_ROOT = Path(__file__).parent.parent.parent

class M3EEmbeddings():
    def __init__(self):
        print("开始加载 Embedding 模型...")
        EMBEDDING_MODEL_DIR = PROJECT_ROOT / "meta" / "embedding" / "bge-m3"
        self.model = BGEM3FlagModel(EMBEDDING_MODEL_DIR, use_fp16=True)

    def encode_documents(self, content: List[str]) -> List[float]:
        return self.model.encode(content, batch_size=12, max_length=8192, return_dense=True, return_sparse=True, return_colbert_vecs=False)['dense_vecs']
    
    def encode_query(self, content: List[str]) -> List[float]:
        return self.model.encode(content, return_dense=True, return_sparse=True, return_colbert_vecs=False)

class Reranker():
    def __init__(self):
        RERANKING_MODEL_DIR = PROJECT_ROOT / "meta" / "reranker" / "bge-reranker-v3-m3"
        self.model = FlagReranker(RERANKING_MODEL_DIR, use_fp16=True)

    def compute_score(self, content: List[str]) -> List[float]:
        return self.model.compute_score(content)

    def compute_score_normalize(self, content: List[str]) -> List[float]:
        return self.model.compute_score(content, normalize=True)

class F:
    def __init__(self):
        self.embedding = M3EEmbeddings()
        self.reranker = Reranker()

if __name__ == '__main__':
    f = F()
    print(f.embedding.encode_query('你好'))
    list = [['what is panda?', 'hi'], ['what is panda?', 'The giant panda (Ailuropoda melanoleuca), sometimes called a panda bear or simply panda, is a bear species endemic to China.']]
    print(f.reranker.compute_score_normalize(list))
