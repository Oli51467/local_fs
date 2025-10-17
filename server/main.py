import os
import logging
from contextlib import asynccontextmanager

import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from config.config import ServerConfig, DatabaseConfig
from api.document_api import router as document_router, init_document_api
from api.chat_api import router as chat_router, init_chat_api
from api.database_api import router as database_router, init_database_api
from api.faiss_api import router as faiss_router, init_faiss_api
from api.cleanup_api import router as cleanup_router
from api.model_api import router as model_router
from api.config_api import router as config_router
from api.status_api import router as status_router, status_broadcaster
from service.sqlite_service import SQLiteManager
from service.faiss_service import FaissManager
from service.image_faiss_service import ImageFaissManager
from service.embedding_service import EmbeddingService
from service.llm_client import SiliconFlowClient
from service.reranker_service import init_reranker_service
from service.bm25s_service import init_bm25s_service
from service.model_manager import get_model_manager

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
    app_ready = False
    init_message = "正在启动系统..."
    await status_broadcaster.broadcast(
        {
            "ready": app_ready,
            "message": init_message,
            "status": "initializing",
        }
    )

    # Ensure model directories exist even if the meta folder was removed
    model_manager = get_model_manager()
    model_manager.ensure_base_directories()

    # Ensure database-related directories exist before services start (idempotent)
    DatabaseConfig.ensure_directories()

    # 初始化嵌入服务
    embedding_instance = EmbeddingService()
    
    # 初始化Reranker服务
    reranker_service_instance = init_reranker_service()
    
    # 初始化BM25S服务
    bm25s_service_instance = init_bm25s_service()
    
    # 初始化SQLite数据库管理器
    sqlite_instance = SQLiteManager()
    init_database_api(sqlite_instance)
    
    # 初始化Faiss向量数据库管理器
    faiss_instance = FaissManager()
    image_faiss_instance = ImageFaissManager()
    init_faiss_api(
        faiss_instance,
        embedding_instance,
        image_faiss_instance,
        bm25s_service_instance,
        reranker_service_instance,
        sqlite_instance,
    )
    
    # 初始化文档API
    init_document_api(
        faiss_instance,
        sqlite_instance,
        image_faiss_instance,
        embedding_instance,
    )
    
    # 初始化对话API
    llm_client_instance = SiliconFlowClient()

    init_chat_api(
        faiss_instance,
        sqlite_instance,
        embedding_instance,
        bm25s_service_instance,
        reranker_service_instance,
        llm_client_instance,
    )
    
    # 初始化清理API
    from api.cleanup_api import init_cleanup_api
    init_cleanup_api(faiss_instance, sqlite_instance, bm25s_service_instance)
    
    logger.info("系统初始化完成")
    app_ready = True
    init_message = "系统初始化完成"
    await status_broadcaster.broadcast(
        {
            "ready": app_ready,
            "message": init_message,
            "status": "ready",
        }
    )
    
    yield
    
    # 关闭时清理
    logger.info("正在关闭系统...")
    app_ready = False
    shutdown_message = "系统正在关闭..."
    await status_broadcaster.broadcast(
        {
            "ready": app_ready,
            "message": shutdown_message,
            "status": "stopping",
        }
    )

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
app.include_router(model_router)
app.include_router(config_router)
app.include_router(chat_router)
app.include_router(status_router)

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

    port = int(os.environ.get("FS_APP_API_PORT", ServerConfig.PORT))
    host = os.environ.get("FS_APP_API_HOST", ServerConfig.HOST)
    uvicorn.run(app, host=host, port=port)
