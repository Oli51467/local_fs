import warnings
warnings.filterwarnings("ignore", message="pkg_resources is deprecated")

import os
import logging
from typing import List, Dict, Any, Optional
from pathlib import Path
from contextlib import asynccontextmanager

from fastapi import FastAPI, File, UploadFile, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import aiofiles

from service.faiss_service import init_databases, FaissManager
from service.sqlite_service import SQLiteManager
from service.document_service import DocumentProcessor
from config.config import DocumentConfig, ServerConfig
from api.database_api import router as database_router, init_database_api
from api.faiss_api import router as faiss_router, init_faiss_api
from model.request_models import SearchRequest, DocumentResponse, SearchResult

# 配置日志
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# 全局变量
sqlite_manager: SQLiteManager = None
faiss_manager: FaissManager = None
document_processor: DocumentProcessor = None

# 系统初始化状态
app_ready = False
init_message = "正在启动系统..."

@asynccontextmanager
async def lifespan(app: FastAPI):
    """应用生命周期管理"""
    global sqlite_manager, faiss_manager, document_processor, app_ready, init_message
    
    try:
        init_message = "正在初始化数据库..."
        logger.info("正在初始化数据库...")
        sqlite_manager, faiss_manager = init_databases()
        
        init_message = "正在初始化文档处理器..."
        logger.info("正在初始化文档处理器...")
        document_processor = DocumentProcessor()
        
        init_message = "正在初始化数据库API..."
        logger.info("正在初始化数据库API...")
        init_database_api(sqlite_manager)
        
        init_message = "正在初始化Faiss API..."
        logger.info("正在初始化Faiss API...")
        init_faiss_api(faiss_manager)
        
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
app = FastAPI(title="LocalFS", version="1.0.0", lifespan=lifespan)

# 添加CORS中间件
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# 包含数据库API路由
app.include_router(database_router)
app.include_router(faiss_router)

@app.get("/health")
async def root():
    return {"message": "文档向量化检索系统", "status": "running"}

@app.get("/api/health/ready")
async def health_ready():
    """检查系统是否准备就绪"""
    global app_ready, init_message
    return {
        "ready": app_ready,
        "message": init_message,
        "status": "ready" if app_ready else "initializing"
    }


if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", ServerConfig.PORT))
    uvicorn.run(
        "main:app", 
        host=ServerConfig.HOST, 
        port=port, 
        log_level="info",
        reload=ServerConfig.DEBUG
    )
