import os
from pathlib import Path

# 项目根目录 - 指向fs根目录而不是server目录
PROJECT_ROOT = Path(__file__).parent.parent.parent

# 数据库配置
class DatabaseConfig:
    # SQLite数据库配置
    SQLITE_DIR = PROJECT_ROOT / "meta" / "sqlite"
    SQLITE_DB_PATH = SQLITE_DIR / "documents.db"
    
    # Faiss向量数据库配置
    VECTOR_DIR = PROJECT_ROOT / "meta" / "vector"
    VECTOR_INDEX_PATH = VECTOR_DIR / "document_vectors.index"
    VECTOR_METADATA_PATH = VECTOR_DIR / "vector_metadata.json"
    
    # 确保目录存在
    @classmethod
    def ensure_directories(cls):
        cls.SQLITE_DIR.mkdir(parents=True, exist_ok=True)
        cls.VECTOR_DIR.mkdir(parents=True, exist_ok=True)

# 文档处理配置
class DocumentConfig:
    # 支持的文件类型
    SUPPORTED_EXTENSIONS = {
        '.txt', '.md', '.pdf', '.docx', '.doc', 
        '.xlsx', '.xls', '.pptx', '.ppt'
    }
    
    # 文档分段配置
    CHUNK_SIZE = 512  # 每个文档块的最大字符数
    CHUNK_OVERLAP = 50  # 文档块之间的重叠字符数
    
    # 向量化配置
    EMBEDDING_MODEL = "sentence-transformers/all-MiniLM-L6-v2"
    VECTOR_DIMENSION = 384  # 向量维度

# 服务器配置
class ServerConfig:
    HOST = "127.0.0.1"
    PORT = 8000
    DEBUG = True