"""
数据库清理API - 用于清空所有数据
"""
from fastapi import APIRouter, HTTPException
import logging
import shutil
from typing import Dict, Any, Optional

from service.faiss_service import FaissManager
from service.sqlite_service import SQLiteManager
from service.bm25s_service import BM25SService
from config.config import DatabaseConfig

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/cleanup", tags=["cleanup"])

# 全局变量
faiss_manager = None
sqlite_manager = None
bm25s_service = None

def init_cleanup_api(
    faiss_mgr: FaissManager,
    sqlite_mgr: SQLiteManager,
    bm25s_srv: Optional[BM25SService],
) -> None:
    """初始化清理API"""
    global faiss_manager, sqlite_manager, bm25s_service
    faiss_manager = faiss_mgr
    sqlite_manager = sqlite_mgr
    bm25s_service = bm25s_srv
    logger.info("Cleanup API initialized")

@router.post("/all")
async def cleanup_all() -> Dict[str, Any]:
    """
    清理所有数据 - 包括数据库、向量索引、BM25S索引和文件
    
    Returns:
        清理结果
    """
    try:
        logger.warning("开始清理所有数据...")
        results = {}
        
        if sqlite_manager is None or faiss_manager is None:
            raise HTTPException(status_code=500, detail="核心服务未初始化")
        
        # 1. 清理SQLite数据库
        try:
            sqlite_manager.cleanup_all()
            logger.info("SQLite数据库清理完成")
            results['sqlite'] = {'status': 'success', 'message': 'SQLite数据库清理完成'}
        except Exception as e:
            logger.error(f"SQLite数据库清理失败: {str(e)}")
            results['sqlite'] = {'status': 'error', 'message': str(e)}
        
        # 2. 清理Faiss向量索引
        try:
            faiss_manager.cleanup_all()
            logger.info("Faiss向量索引清理完成")
            results['faiss'] = {'status': 'success', 'message': 'Faiss向量索引清理完成'}
        except Exception as e:
            logger.error(f"Faiss向量索引清理失败: {str(e)}")
            results['faiss'] = {'status': 'error', 'message': str(e)}
        
        # 3. 清理BM25S索引
        try:
            if bm25s_service:
                bm25s_service.cleanup_all()
                logger.info("BM25S索引清理完成")
                results['bm25s'] = {'status': 'success', 'message': 'BM25S索引清理完成'}
            else:
                results['bm25s'] = {'status': 'warning', 'message': 'BM25S服务未初始化'}
        except Exception as e:
            logger.error(f"BM25S索引清理失败: {str(e)}")
            results['bm25s'] = {'status': 'error', 'message': str(e)}
        
        # 4. 清理数据文件
        try:
            data_dir = DatabaseConfig.DATABASE_DIR
            if data_dir.exists():
                # 删除数据目录下的所有文件，但保留目录结构
                for item in data_dir.iterdir():
                    if item.is_file():
                        item.unlink()
                        logger.info(f"删除文件: {item}")
                    elif item.is_dir() and item.name not in ['__pycache__']:
                        # 删除子目录及其内容
                        shutil.rmtree(item)
                        logger.info(f"删除目录: {item}")
                
                # 重新创建必要的目录
                DatabaseConfig.ensure_directories()
                results["data_files"] = "success"
                logger.info("数据文件清理完成")
            else:
                results["data_files"] = "skipped (directory not exists)"
        except Exception as e:
            results["data_files"] = f"failed: {str(e)}"
            logger.error(f"数据文件清理失败: {str(e)}")
        
        # 统计结果
        success_count = sum(1 for v in results.values() if v == "success")
        total_count = len(results)
        
        logger.warning(f"数据清理完成: {success_count}/{total_count} 项成功")
        
        return {
            "status": "completed",
            "results": results,
            "summary": {
                "total": total_count,
                "success": success_count,
                "failed": total_count - success_count
            },
            "message": "数据清理完成，所有文档和索引已清空"
        }
        
    except Exception as e:
        logger.error(f"清理所有数据时出错: {str(e)}")
        raise HTTPException(status_code=500, detail=f"清理数据失败: {str(e)}")

@router.post("/faiss-vectors")
async def cleanup_faiss_vectors() -> Dict[str, Any]:
    """
    清空Faiss向量数据库中的所有向量，但保留索引结构
    
    Returns:
        清理结果
    """
    try:
        logger.warning("开始清空Faiss向量数据库...")
        
        # 获取Faiss管理器
        if faiss_manager is None:
            raise HTTPException(status_code=500, detail="Faiss管理器未初始化")
        
        # 清空向量数据但保留索引结构
        try:
            # 获取当前向量数量
            vector_count = faiss_manager.get_total_vectors()
            metadata_count = len(faiss_manager.metadata) if hasattr(faiss_manager, 'metadata') and faiss_manager.metadata else 0
            
            logger.info(f"清理前统计 - 索引中向量数: {vector_count}, 元数据数量: {metadata_count}")
            
            # 使用cleanup_all方法清空所有向量数据
            faiss_manager.cleanup_all()
            
            # 验证清理后的数量
            vector_count_after = faiss_manager.get_total_vectors()
            metadata_count_after = len(faiss_manager.metadata) if hasattr(faiss_manager, 'metadata') and faiss_manager.metadata else 0
            
            logger.info(f"清理后统计 - 索引中向量数: {vector_count_after}, 元数据数量: {metadata_count_after}")
            
            logger.info(f"Faiss向量数据库清空完成，删除了 {vector_count} 个向量")
            
            return {
                "status": "success",
                "message": f"Faiss向量数据库已清空，删除了 {vector_count} 个向量",
                "deleted_vectors": vector_count,
                "index_structure_preserved": True
            }
            
        except Exception as e:
            logger.error(f"清空Faiss向量数据库失败: {str(e)}")
            raise HTTPException(status_code=500, detail=f"清空Faiss向量失败: {str(e)}")
            
    except Exception as e:
        logger.error(f"清空Faiss向量数据库时出错: {str(e)}")
        raise HTTPException(status_code=500, detail=f"清空Faiss向量失败: {str(e)}")

@router.post("/sqlite-data")
async def cleanup_sqlite_data() -> Dict[str, Any]:
    """
    清空SQLite表中的所有数据，但保留表结构
    
    Returns:
        清理结果
    """
    try:
        logger.warning("开始清空SQLite表数据...")
        
        # 获取SQLite管理器
        if sqlite_manager is None:
            raise HTTPException(status_code=500, detail="SQLite管理器未初始化")
        
        try:
            # 获取删除前的文档数量
            doc_count_before = sqlite_manager.get_document_count()
            
            # 清空数据表但保留结构
            sqlite_manager.cleanup_all()  # 这个方法会清空数据但保留表结构
            
            # 获取删除后的数量
            doc_count_after = sqlite_manager.get_document_count()
            
            logger.info(f"SQLite表数据清空完成，删除了 {doc_count_before} 个文档")
            
            return {
                "status": "success", 
                "message": f"SQLite表数据已清空，删除了 {doc_count_before} 个文档",
                "deleted_documents": doc_count_before,
                "table_structure_preserved": True,
                "remaining_documents": doc_count_after
            }
            
        except Exception as e:
            logger.error(f"清空SQLite表数据失败: {str(e)}")
            raise HTTPException(status_code=500, detail=f"清空SQLite数据失败: {str(e)}")
            
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"清空SQLite表数据时出错: {str(e)}")
        raise HTTPException(status_code=500, detail=f"清空SQLite数据失败: {str(e)}")

@router.get("/status")
async def get_cleanup_status() -> Dict[str, Any]:
    """
    获取当前数据状态
    
    Returns:
        数据状态信息
    """
    try:
        status = {}
        
        # 检查数据库文件
        if DatabaseConfig.SQLITE_DB_PATH.exists():
            file_size = DatabaseConfig.SQLITE_DB_PATH.stat().st_size
            status["sqlite_exists"] = True
            status["sqlite_size"] = file_size
        else:
            status["sqlite_exists"] = False
            status["sqlite_size"] = 0
        
        # 检查向量索引文件
        if DatabaseConfig.VECTOR_INDEX_PATH.exists():
            file_size = DatabaseConfig.VECTOR_INDEX_PATH.stat().st_size
            status["faiss_exists"] = True
            status["faiss_size"] = file_size
        else:
            status["faiss_exists"] = False
            status["faiss_size"] = 0
        
        # 检查数据目录
        if DatabaseConfig.DATABASE_DIR.exists():
            # 统计文件数量和总大小
            file_count = 0
            total_size = 0
            for item in DatabaseConfig.DATABASE_DIR.rglob("*"):
                if item.is_file():
                    file_count += 1
                    total_size += item.stat().st_size
            
            status["data_dir_exists"] = True
            status["data_file_count"] = file_count
            status["data_total_size"] = total_size
        else:
            status["data_dir_exists"] = False
            status["data_file_count"] = 0
            status["data_total_size"] = 0
        
        # 估算文档数量（如果有数据库连接）
        if sqlite_manager:
            try:
                doc_count = sqlite_manager.get_document_count()
                status["document_count"] = doc_count
            except:
                status["document_count"] = "unknown"
        else:
            status["document_count"] = "unknown"
        
        return {
            "status": "success",
            "data_status": status,
            "paths": {
                "database_dir": str(DatabaseConfig.DATABASE_DIR),
                "sqlite_db": str(DatabaseConfig.SQLITE_DB_PATH),
                "vector_index": str(DatabaseConfig.VECTOR_INDEX_PATH)
            }
        }
        
    except Exception as e:
        logger.error(f"获取数据状态时出错: {str(e)}")
        raise HTTPException(status_code=500, detail=f"获取数据状态失败: {str(e)}")
