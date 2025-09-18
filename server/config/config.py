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

class DatabaseConfig:
    """数据库配置"""
    
    # 项目根目录
    PROJECT_ROOT = Path(__file__).parent.parent.parent
    
    # 数据库目录
    DATABASE_DIR = PROJECT_ROOT / "data"
    
    # SQLite数据库路径
    SQLITE_DB_PATH = DATABASE_DIR / "documents.db"
    
    # Faiss向量数据库路径
    VECTOR_INDEX_PATH = DATABASE_DIR / "vector_index.faiss"
    VECTOR_METADATA_PATH = DATABASE_DIR / "vector_metadata.json"
    
    @classmethod
    def ensure_directories(cls):
        """确保必要的目录存在"""
        cls.DATABASE_DIR.mkdir(parents=True, exist_ok=True)