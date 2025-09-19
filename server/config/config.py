from pathlib import Path

class ServerConfig:
    """服务器配置"""
    HOST = "0.0.0.0"
    PORT = 8000
    DEBUG = True
    
    # 项目根目录
    PROJECT_ROOT = Path(__file__).parent.parent.parent
    
    # 模型路径配置
    BGE_M3_MODEL_PATH = PROJECT_ROOT / "meta" / "embedding" / "bge-m3"
    BGE_RERANKER_MODEL_PATH = PROJECT_ROOT / "meta" / "reranker" / "bge-reranker-v2-m3"
    
    # BM25S混合打分权重配置
    BM25S_WEIGHT = 0.7  # BM25S分数权重
    EMBEDDING_WEIGHT = 0.3  # 向量相似度分数权重
    
    # 文本分割器配置
    TEXT_SPLITTER_TYPE = "recursive"  # 分割器类型: "recursive" 或 "semantic"
    
    # 递归字符分割器配置（默认）
    RECURSIVE_CHUNK_SIZE = 300
    RECURSIVE_CHUNK_OVERLAP = 80
    RECURSIVE_SEPARATORS = ["\n\n", "\n", " ", ""]
    
    # 语义分割器配置
    SEMANTIC_BREAKPOINT_THRESHOLD_TYPE = "percentile"  # 断点阈值类型
    SEMANTIC_BREAKPOINT_THRESHOLD_AMOUNT = 90.0  # 断点阈值量

class DatabaseConfig:
    """数据库配置"""
    
    # 项目根目录
    PROJECT_ROOT = Path(__file__).parent.parent.parent
    
    # 数据库目录
    DATABASE_DIR = PROJECT_ROOT / "data"
    SQLITE_DIR = PROJECT_ROOT / "meta" / "sqlite"
    VECTOR_DIR = PROJECT_ROOT / "meta" / "vector"
    
    # SQLite数据库路径
    SQLITE_DB_PATH = SQLITE_DIR / "documents.db"
    
    # Faiss向量数据库路径
    VECTOR_INDEX_PATH = VECTOR_DIR / "vector_index.faiss"
    VECTOR_METADATA_PATH = VECTOR_DIR / "vector_metadata.json"
    
    @classmethod
    def ensure_directories(cls):
        """确保必要的目录存在"""
        cls.DATABASE_DIR.mkdir(parents=True, exist_ok=True)
        cls.SQLITE_DIR.mkdir(parents=True, exist_ok=True)
        cls.VECTOR_DIR.mkdir(parents=True, exist_ok=True)