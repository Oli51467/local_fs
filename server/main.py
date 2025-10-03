import os
import logging
from contextlib import asynccontextmanager

import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from config.config import ServerConfig
from api.document_api import router as document_router, init_document_api
from api.database_api import router as database_router, init_database_api
from api.faiss_api import router as faiss_router, init_faiss_api
from api.cleanup_api import router as cleanup_router
from api.config_api import router as config_router
from service.sqlite_service import SQLiteManager
from service.faiss_service import FaissManager
from service.image_faiss_service import ImageFaissManager
from service.embedding_service import EmbeddingService
from service.reranker_service import init_reranker_service
from service.bm25s_service import init_bm25s_service

# 配置日志
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# 系统初始化状态
app_ready = False
init_message = "正在启动系统..."

@asynccontextmanager
async def lifespan(app: FastAPI):
    # 启动时初始化
    global sqlite_instance, faiss_instance, embedding_instance, app_ready, init_message
    
    logger.info("正在初始化系统...")
    
    # 初始化嵌入服务
    embedding_instance = EmbeddingService()
    
    # 初始化Reranker服务
    init_reranker_service()
    
    # 初始化BM25S服务
    bm25s_service_instance = init_bm25s_service()
    
    # 初始化SQLite数据库管理器
    sqlite_instance = SQLiteManager()
    init_database_api(sqlite_instance)
    
    # 初始化Faiss向量数据库管理器
    faiss_instance = FaissManager()
    image_faiss_instance = ImageFaissManager()
    init_faiss_api(faiss_instance, embedding_instance, image_faiss_instance)
    
    # 初始化文档API
    init_document_api(faiss_instance, sqlite_instance, image_faiss_instance)
    
    # 初始化清理API
    from api.cleanup_api import init_cleanup_api
    init_cleanup_api(faiss_instance, sqlite_instance, bm25s_service_instance)
    
    logger.info("系统初始化完成")
    app_ready = True
    init_message = "系统初始化完成"
    
    yield
    
    # 关闭时清理
    logger.info("正在关闭系统...")

app = FastAPI(
    title="文档管理系统API",
    description="基于FastAPI的文档管理和向量搜索系统",
    version="1.0.0",
    lifespan=lifespan
)

# 配置CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # 在生产环境中应该设置具体的域名
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# 注册路由
app.include_router(database_router)
app.include_router(faiss_router)
app.include_router(document_router)
app.include_router(cleanup_router)
app.include_router(config_router)

@app.get("/")
async def root():
    return {"message": "文档管理系统API", "version": "1.0.0", "status": "running"}

@app.get("/api/health/ready")
async def health_ready():
    global app_ready, init_message
    return {
        "ready": app_ready,
        "message": init_message,
        "status": "ready" if app_ready else "initializing"
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
