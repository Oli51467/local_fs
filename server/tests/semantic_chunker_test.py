import sys
import os
sys.path.append(os.path.join(os.path.dirname(__file__), '..'))

from langchain_experimental.text_splitter import SemanticChunker
from service.langchain_embedding_service import BGEM3LangChainWrapper
from pathlib import Path

PROJECT_ROOT = Path(__file__).parent.parent.parent
BGE_M3_MODEL_PATH = PROJECT_ROOT / "meta" / "embedding" / "bge-m3"

# 使用LangChain兼容的包装类
embedding_model = BGEM3LangChainWrapper(BGE_M3_MODEL_PATH, use_fp16=True)
# 使用percentile方法，阈值90%
text_splitter = SemanticChunker(
    embedding_model, 
    breakpoint_threshold_type="percentile",
    breakpoint_threshold_amount=90.0
)

if __name__ == "__main__":
    with open("../../data/test2.txt") as f:
        state_of_the_union = f.read()
        docs = text_splitter.create_documents([state_of_the_union])
        print(docs[1].page_content)
        print(len(docs))