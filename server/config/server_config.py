from pathlib import Path

class ServerConfig:
    HOST = "0.0.0.0"
    PORT = 8000
    DEBUG = True
    
    # 项目根目录
    PROJECT_ROOT = Path(__file__).parent.parent.parent
    
    # 模型路径配置
    BGE_M3_MODEL_PATH = PROJECT_ROOT / "meta" / "embedding" / "bge-m3"
    BGE_RERANKER_MODEL_PATH = PROJECT_ROOT / "meta" / "reranker" / "bge-reranker-v2-m3"