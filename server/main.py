import os
import logging
from contextlib import asynccontextmanager

import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from config.server_config import ServerConfig
from api.document_api import router as document_router
from api.database_api import router as database_router, init_database_api
from api.faiss_api import router as faiss_router, init_faiss_api
from service.sqlite_service import SQLiteManager
from service.faiss_service import FaissManager

# 配置日志
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# 系统初始化状态
app_ready = False
init_message = "正在启动系统..."

@asynccontextmanager
async def lifespan(app: FastAPI):
    """应用生命周期管理"""
    global sqlite_instance, faiss_instance, app_ready, init_message
    
    try:
        init_message = "正在初始化数据库..."
        logger.info("开始初始化系统组件")
        
        # 初始化SQLite管理器
        sqlite_instance = SQLiteManager()
        sqlite_instance.init_database()
        init_database_api(sqlite_instance)
        logger.info("SQLite数据库初始化完成")
        
        # 初始化Faiss管理器
        faiss_instance = FaissManager(dimension=1024)
        init_faiss_api(faiss_instance)
        logger.info("Faiss向量数据库初始化完成")
        
        init_message = "系统初始化完成"
        app_ready = True
        logger.info("系统初始化完成")
    except Exception as e:
        init_message = f"系统初始化失败: {str(e)}"
        logger.error(f"系统初始化失败: {str(e)}")
        raise
    
    yield
    
    # 清理资源（如果需要）
    app_ready = False
    logger.info("应用关闭，清理资源")

# 创建FastAPI应用
app = FastAPI(title="LoFS", version="1.0.0", lifespan=lifespan)

# 添加CORS中间件
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# 注册路由
app.include_router(document_router)
app.include_router(database_router)
app.include_router(faiss_router)

@app.get("/health")
async def root():
    return {"message": "LoFS", "status": "running"}

@app.get("/api/health/ready")
async def health_ready():
    global app_ready, init_message
    return {
        "ready": app_ready,
        "message": init_message,
        "status": "ready" if app_ready else "initializing"
    }


if __name__ == "__main__":
    port = int(os.environ.get("PORT", ServerConfig.PORT))
    uvicorn.run(
        "main:app", 
        host=ServerConfig.HOST, 
        port=port, 
        log_level="info",
        reload=ServerConfig.DEBUG
    )
