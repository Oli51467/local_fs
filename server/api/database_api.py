from fastapi import APIRouter, HTTPException
from typing import List, Dict, Any
from service.sqlite_service import SQLiteManager
import sqlite3
import logging

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/database", tags=["database"])

# 全局SQLite管理器实例
sqlite_manager = None

def init_database_api(sqlite_mgr: SQLiteManager):
    """初始化数据库API，传入SQLite管理器实例"""
    global sqlite_manager
    sqlite_manager = sqlite_mgr

@router.get("/test-connection")
async def test_database_connection():
    """测试数据库连接"""
    try:
        if sqlite_manager is None:
            raise HTTPException(status_code=500, detail="数据库管理器未初始化")
        
        # 尝试连接数据库并执行简单查询
        with sqlite3.connect(sqlite_manager.db_path) as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT 1")
            result = cursor.fetchone()
            
        return {
            "status": "success",
            "message": "数据库连接成功",
            "database_path": str(sqlite_manager.db_path)
        }
    except Exception as e:
        logger.error(f"数据库连接测试失败: {str(e)}")
        raise HTTPException(status_code=500, detail=f"数据库连接失败: {str(e)}")

@router.get("/tables")
async def get_all_tables():
    """获取所有表名"""
    try:
        if sqlite_manager is None:
            raise HTTPException(status_code=500, detail="数据库管理器未初始化")
        
        with sqlite3.connect(sqlite_manager.db_path) as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
            tables = [row[0] for row in cursor.fetchall()]
            
        return {
            "status": "success",
            "tables": tables
        }
    except Exception as e:
        logger.error(f"获取表列表失败: {str(e)}")
        raise HTTPException(status_code=500, detail=f"获取表列表失败: {str(e)}")

@router.get("/table/{table_name}")
async def get_table_data(table_name: str, limit: int = 100):
    """获取指定表的数据"""
    try:
        if sqlite_manager is None:
            raise HTTPException(status_code=500, detail="数据库管理器未初始化")
        
        # 验证表名是否存在（防止SQL注入）
        with sqlite3.connect(sqlite_manager.db_path) as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name=?", (table_name,))
            if not cursor.fetchone():
                raise HTTPException(status_code=404, detail=f"表 '{table_name}' 不存在")
            
            # 获取表结构
            cursor.execute(f"PRAGMA table_info({table_name})")
            columns_info = cursor.fetchall()
            columns = [col[1] for col in columns_info]  # col[1] 是列名
            
            # 获取数据
            cursor.execute(f"SELECT * FROM {table_name} LIMIT ?", (limit,))
            rows = cursor.fetchall()
            
            # 获取总行数
            cursor.execute(f"SELECT COUNT(*) FROM {table_name}")
            total_count = cursor.fetchone()[0]
            
        # 将数据转换为字典格式
        data = []
        for row in rows:
            row_dict = {}
            for i, value in enumerate(row):
                row_dict[columns[i]] = value
            data.append(row_dict)
            
        return {
            "status": "success",
            "table_name": table_name,
            "columns": columns,
            "data": data,
            "total_count": total_count,
            "returned_count": len(data)
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"获取表数据失败: {str(e)}")
        raise HTTPException(status_code=500, detail=f"获取表数据失败: {str(e)}")

@router.get("/statistics")
async def get_database_statistics():
    """获取数据库统计信息"""
    try:
        if sqlite_manager is None:
            raise HTTPException(status_code=500, detail="数据库管理器未初始化")
        
        stats = sqlite_manager.get_statistics()
        return {
            "status": "success",
            "statistics": stats
        }
    except Exception as e:
        logger.error(f"获取数据库统计信息失败: {str(e)}")
        raise HTTPException(status_code=500, detail=f"获取数据库统计信息失败: {str(e)}")