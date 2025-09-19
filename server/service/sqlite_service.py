import sqlite3
import json
import logging
from pathlib import Path
from typing import List, Dict, Any, Optional
from config.config import DatabaseConfig

logger = logging.getLogger(__name__)

class SQLiteManager:
    """SQLite数据库管理器"""
    
    def __init__(self):
        self.db_path = DatabaseConfig.SQLITE_DB_PATH
        DatabaseConfig.ensure_directories()
        self.init_database()
    
    def init_database(self):
        """初始化数据库表结构"""
        with sqlite3.connect(self.db_path) as conn:
            cursor = conn.cursor()
            
            # 创建文件元数据表
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS documents (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    filename TEXT NOT NULL,
                    file_path TEXT NOT NULL,
                    file_type TEXT NOT NULL,
                    file_size INTEGER NOT NULL,
                    upload_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    content_hash TEXT UNIQUE NOT NULL,
                    total_chunks INTEGER DEFAULT 0,
                    UNIQUE(file_path)
                )
            """)
            
            # 创建文档块表
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS document_chunks (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    document_id INTEGER NOT NULL,
                    chunk_index INTEGER NOT NULL,
                    content TEXT NOT NULL,
                    vector_id INTEGER,
                    created_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (document_id) REFERENCES documents (id) ON DELETE CASCADE,
                    UNIQUE(document_id, chunk_index)
                )
            """)
            
            # 创建索引
            cursor.execute("CREATE INDEX IF NOT EXISTS idx_documents_hash ON documents(content_hash)")
            cursor.execute("CREATE INDEX IF NOT EXISTS idx_chunks_document ON document_chunks(document_id)")
            cursor.execute("CREATE INDEX IF NOT EXISTS idx_chunks_vector ON document_chunks(vector_id)")
            
            conn.commit()
    
    def insert_document(self, filename: str, file_path: str, file_type: str, 
                       file_size: int, file_hash: str, content: str = None, metadata: dict = None) -> int:
        """插入文档记录"""
        with sqlite3.connect(self.db_path) as conn:
            cursor = conn.cursor()
            cursor.execute("""
                INSERT OR REPLACE INTO documents 
                (filename, file_path, file_type, file_size, content_hash)
                VALUES (?, ?, ?, ?, ?)
            """, (filename, file_path, file_type, file_size, file_hash))
            return cursor.lastrowid
    
    def insert_chunk(self, document_id: int, chunk_index: int, content: str, vector_id: int = None, metadata: dict = None) -> int:
        """插入文档块记录"""
        with sqlite3.connect(self.db_path) as conn:
            cursor = conn.cursor()
            cursor.execute("""
                INSERT OR REPLACE INTO document_chunks 
                (document_id, chunk_index, content, vector_id)
                VALUES (?, ?, ?, ?)
            """, (document_id, chunk_index, content, vector_id))
            return cursor.lastrowid
    
    def get_documents_by_filename(self, filename: str) -> List[Dict]:
        """根据文件名获取文档"""
        with sqlite3.connect(self.db_path) as conn:
            cursor = conn.cursor()
            cursor.execute("""
                SELECT id, filename, file_path, file_type, file_size, 
                       upload_time, content_hash, total_chunks
                FROM documents 
                WHERE filename = ?
                ORDER BY upload_time DESC
            """, (filename,))
            
            results = []
            for row in cursor.fetchall():
                results.append({
                    'id': row[0],
                    'filename': row[1],
                    'file_path': row[2],
                    'file_type': row[3],
                    'file_size': row[4],
                    'upload_time': row[5],
                    'file_hash': row[6],
                    'total_chunks': row[7]
                })
            return results
    
    def update_document_chunks_count(self, document_id: int, total_chunks: int):
        """更新文档的总块数"""
        with sqlite3.connect(self.db_path) as conn:
            cursor = conn.cursor()
            cursor.execute("""
                UPDATE documents SET total_chunks = ? WHERE id = ?
            """, (total_chunks, document_id))
    
    def search_documents(self, query: str) -> List[Dict]:
        """全文搜索文档"""
        with sqlite3.connect(self.db_path) as conn:
            cursor = conn.cursor()
            cursor.execute("""
                SELECT d.id, d.filename, d.file_path, d.file_type, 
                       dc.chunk_index, dc.content, dc.vector_id
                FROM documents d
                JOIN document_chunks dc ON d.id = dc.document_id
                WHERE dc.content LIKE ?
                ORDER BY d.upload_time DESC
            """, (f"%{query}%",))
            
            results = []
            for row in cursor.fetchall():
                results.append({
                    'document_id': row[0],
                    'filename': row[1],
                    'file_path': row[2],
                    'file_type': row[3],
                    'chunk_index': row[4],
                    'content': row[5],
                    'vector_id': row[6]
                })
            return results
    
    def get_chunk_by_vector_id(self, vector_id: int) -> Optional[Dict]:
        """根据向量ID获取文档块"""
        with sqlite3.connect(self.db_path) as conn:
            cursor = conn.cursor()
            cursor.execute("""
                SELECT d.id, d.filename, d.file_path, d.file_type,
                       dc.chunk_index, dc.content, dc.vector_id
                FROM documents d
                JOIN document_chunks dc ON d.id = dc.document_id
                WHERE dc.vector_id = ?
            """, (vector_id,))
            
            row = cursor.fetchone()
            if row:
                return {
                    'document_id': row[0],
                    'filename': row[1],
                    'file_path': row[2],
                    'file_type': row[3],
                    'chunk_index': row[4],
                    'content': row[5],
                    'vector_id': row[6]
                }
            return None
    
    def get_all_document_chunks(self) -> List[Dict]:
        """获取所有文档块"""
        with sqlite3.connect(self.db_path) as conn:
            cursor = conn.cursor()
            cursor.execute("""
                SELECT d.id, d.filename, d.file_path, d.file_type,
                       dc.chunk_index, dc.content, dc.vector_id
                FROM documents d
                JOIN document_chunks dc ON d.id = dc.document_id
                ORDER BY d.upload_time DESC, dc.chunk_index
            """)
            
            results = []
            for row in cursor.fetchall():
                results.append({
                    'document_id': row[0],
                    'filename': row[1],
                    'file_path': row[2],
                    'file_type': row[3],
                    'chunk_index': row[4],
                    'content': row[5],
                    'vector_id': row[6]
                })
            return results
    
    def get_statistics(self) -> Dict[str, Any]:
        """获取数据库统计信息"""
        with sqlite3.connect(self.db_path) as conn:
            cursor = conn.cursor()
            
            # 获取文档数量
            cursor.execute("SELECT COUNT(*) FROM documents")
            document_count = cursor.fetchone()[0]
            
            # 获取文档块数量
            cursor.execute("SELECT COUNT(*) FROM document_chunks")
            chunk_count = cursor.fetchone()[0]
            
            # 获取文件类型统计
            cursor.execute("""
                SELECT file_type, COUNT(*) 
                FROM documents 
                GROUP BY file_type
            """)
            file_types = dict(cursor.fetchall())
            
            return {
                'total_documents': document_count,
                'total_chunks': chunk_count,
                'file_types': file_types
            }
    
    def get_document_count(self) -> int:
        """获取文档总数"""
        try:
            with sqlite3.connect(self.db_path) as conn:
                cursor = conn.cursor()
                cursor.execute("SELECT COUNT(*) FROM documents")
                return cursor.fetchone()[0]
        except:
            return 0
    
    def cleanup_all(self):
        """清理所有数据"""
        try:
            with sqlite3.connect(self.db_path) as conn:
                cursor = conn.cursor()
                
                # 删除所有数据（保留表结构）
                cursor.execute("DELETE FROM document_chunks")
                cursor.execute("DELETE FROM documents")
                
                # 重置自增ID
                cursor.execute("DELETE FROM sqlite_sequence WHERE name IN ('documents', 'document_chunks')")
                
                conn.commit()
                logger.info("SQLite数据库清理完成")
                
        except Exception as e:
            logger.error(f"SQLite数据库清理失败: {str(e)}")
            raise e

# 全局SQLite管理器实例
sqlite_manager_instance = None

def init_sqlite_manager():
    """初始化全局SQLite管理器"""
    global sqlite_manager_instance
    sqlite_manager_instance = SQLiteManager()
    return sqlite_manager_instance

def get_sqlite_manager():
    """获取全局SQLite管理器实例"""
    return sqlite_manager_instance