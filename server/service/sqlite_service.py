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
            
            # 启用外键约束
            cursor.execute("PRAGMA foreign_keys = ON")
            
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
            
            # 获取总块数（从metadata中获取）
            total_chunks = 0
            if metadata and 'chunks_count' in metadata:
                total_chunks = metadata['chunks_count']
            
            # 调试日志
            logger.info(f"插入文档 - metadata: {metadata}, chunks_count: {total_chunks}")
            
            cursor.execute("""
                INSERT OR REPLACE INTO documents 
                (filename, file_path, file_type, file_size, content_hash, total_chunks)
                VALUES (?, ?, ?, ?, ?, ?)
            """, (filename, file_path, file_type, file_size, file_hash, total_chunks))
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

    def get_document_by_path_and_hash(self, file_path: str, file_hash: str) -> Optional[Dict]:
        """根据文件路径和哈希值获取文档（用于精确匹配）"""
        with sqlite3.connect(self.db_path) as conn:
            cursor = conn.cursor()
            cursor.execute("""
                SELECT id, filename, file_path, file_type, file_size, 
                       upload_time, content_hash, total_chunks
                FROM documents 
                WHERE file_path = ? AND content_hash = ?
                ORDER BY upload_time DESC
                LIMIT 1
            """, (file_path, file_hash))
            
            row = cursor.fetchone()
            if row:
                return {
                    'id': row[0],
                    'filename': row[1],
                    'file_path': row[2],
                    'file_type': row[3],
                    'file_size': row[4],
                    'upload_time': row[5],
                    'file_hash': row[6],
                    'total_chunks': row[7]
                }
            return None

    def get_documents_by_hash(self, file_hash: str) -> List[Dict]:
        """根据文件哈希值获取所有相关文档（用于检测重复文件）"""
        with sqlite3.connect(self.db_path) as conn:
            cursor = conn.cursor()
            cursor.execute("""
                SELECT id, filename, file_path, file_type, file_size, 
                       upload_time, content_hash, total_chunks
                FROM documents 
                WHERE content_hash = ?
                ORDER BY upload_time DESC
            """, (file_hash,))
            
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
    
    def update_document_path(self, old_path: str, new_path: str) -> bool:
        """更新文档的文件路径"""
        try:
            with sqlite3.connect(self.db_path) as conn:
                cursor = conn.cursor()
                cursor.execute("""
                    UPDATE documents SET file_path = ? WHERE file_path = ?
                """, (new_path, old_path))
                return cursor.rowcount > 0
        except Exception as e:
            logger.error(f"更新文档路径失败: {str(e)}")
            return False
    
    def update_documents_by_path_prefix(self, old_prefix: str, new_prefix: str) -> int:
        """更新所有以指定前缀开头的文档路径（用于文件夹重命名）"""
        try:
            with sqlite3.connect(self.db_path) as conn:
                cursor = conn.cursor()
                # 找到所有以旧前缀开头的文档
                cursor.execute("""
                    SELECT id, file_path, filename FROM documents WHERE file_path LIKE ?
                """, (f"{old_prefix}%",))
                
                updated_count = 0
                for row in cursor.fetchall():
                    doc_id = row[0]
                    old_file_path = row[1]
                    old_filename = row[2]
                    # 构建新路径：将旧前缀替换为新前缀
                    new_file_path = old_file_path.replace(old_prefix, new_prefix, 1)
                    # 从新的文件路径中提取新的文件名
                    new_filename = pathlib.Path(new_file_path).name
                    
                    cursor.execute("""
                        UPDATE documents SET file_path = ?, filename = ? WHERE id = ?
                    """, (new_file_path, new_filename, doc_id))
                    updated_count += 1
                
                return updated_count
        except Exception as e:
            logger.error(f"批量更新文档路径失败: {str(e)}")
            return 0
    
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
    
    def get_document_chunks(self, document_id: int) -> List[Dict]:
        """获取指定文档的所有块"""
        with sqlite3.connect(self.db_path) as conn:
            cursor = conn.cursor()
            cursor.execute("""
                SELECT d.id, d.filename, d.file_path, d.file_type,
                       dc.chunk_index, dc.content, dc.vector_id
                FROM documents d
                JOIN document_chunks dc ON d.id = dc.document_id
                WHERE d.id = ?
                ORDER BY dc.chunk_index
            """, (document_id,))
            
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

    def delete_document_by_path(self, file_path: str) -> int:
        """根据文件路径删除文档记录和相关块数据"""
        try:
            with sqlite3.connect(self.db_path) as conn:
                cursor = conn.cursor()
                
                # 启用外键约束
                cursor.execute("PRAGMA foreign_keys = ON")
                
                # 首先获取文档ID
                cursor.execute("SELECT id FROM documents WHERE file_path = ?", (file_path,))
                result = cursor.fetchone()
                
                if not result:
                    logger.warning(f"未找到文档路径: {file_path}")
                    return 0
                
                doc_id = result[0]
                
                # 删除文档（由于设置了ON DELETE CASCADE，相关的块数据会自动删除）
                cursor.execute("DELETE FROM documents WHERE id = ?", (doc_id,))
                deleted_count = cursor.rowcount
                
                # 重置sqlite_sequence表中的自增序列值
                if deleted_count > 0:
                    # 获取当前最大ID值
                    cursor.execute("SELECT MAX(id) FROM documents")
                    max_doc_id = cursor.fetchone()[0] or 0
                    cursor.execute("UPDATE sqlite_sequence SET seq = ? WHERE name = 'documents'", (max_doc_id,))
                    
                    # 获取document_chunks表当前最大ID值
                    cursor.execute("SELECT MAX(id) FROM document_chunks")
                    max_chunk_id = cursor.fetchone()[0] or 0
                    cursor.execute("UPDATE sqlite_sequence SET seq = ? WHERE name = 'document_chunks'", (max_chunk_id,))
                
                conn.commit()
                
                logger.info(f"删除文档成功: {file_path} (ID: {doc_id}), 删除了 {deleted_count} 个文档记录")
                
                return deleted_count
                
        except Exception as e:
            logger.error(f"删除文档失败: {str(e)}")
            return 0

    def delete_documents_by_path_prefix(self, folder_path: str) -> int:
        """根据文件夹路径前缀删除所有相关文档和块数据"""
        try:
            with sqlite3.connect(self.db_path) as conn:
                cursor = conn.cursor()
                
                # 启用外键约束
                cursor.execute("PRAGMA foreign_keys = ON")
                
                # 确保路径前缀格式正确（以/结尾）
                if not folder_path.endswith('/'):
                    folder_path += '/'
                
                # 获取所有匹配的文档ID
                cursor.execute("""
                    SELECT DISTINCT d.id
                    FROM documents d
                    WHERE d.file_path LIKE ?
                """, (f"{folder_path}%",))
                
                results = cursor.fetchall()
                
                if not results:
                    logger.warning(f"未找到以该前缀开头的文档: {folder_path}")
                    return 0
                
                # 提取唯一的文档ID
                doc_ids = [row[0] for row in results]
                
                # 删除所有匹配的文档（由于级联删除，块数据也会自动删除）
                cursor.execute(f"""
                    DELETE FROM documents 
                    WHERE id IN ({','.join(['?' for _ in doc_ids])})
                """, doc_ids)
                
                deleted_count = cursor.rowcount
                
                # 重置sqlite_sequence表中的自增序列值
                if deleted_count > 0:
                    # 获取当前最大ID值
                    cursor.execute("SELECT MAX(id) FROM documents")
                    max_doc_id = cursor.fetchone()[0] or 0
                    cursor.execute("UPDATE sqlite_sequence SET seq = ? WHERE name = 'documents'", (max_doc_id,))
                    
                    # 获取document_chunks表当前最大ID值
                    cursor.execute("SELECT MAX(id) FROM document_chunks")
                    max_chunk_id = cursor.fetchone()[0] or 0
                    cursor.execute("UPDATE sqlite_sequence SET seq = ? WHERE name = 'document_chunks'", (max_chunk_id,))
                
                conn.commit()
                
                logger.info(f"批量删除文档成功: 前缀 {folder_path}, 删除了 {deleted_count} 个文档")
                
                return deleted_count
                
        except Exception as e:
            logger.error(f"批量删除文档失败: {str(e)}")
            return 0

    def get_vector_ids_by_path(self, file_path: str) -> List[int]:
        """根据文件路径获取所有相关的向量ID"""
        try:
            with sqlite3.connect(self.db_path) as conn:
                cursor = conn.cursor()
                
                # 获取文档ID
                cursor.execute("SELECT id FROM documents WHERE file_path = ?", (file_path,))
                result = cursor.fetchone()
                
                if not result:
                    return []
                
                doc_id = result[0]
                
                # 获取所有相关的向量ID
                cursor.execute("SELECT vector_id FROM document_chunks WHERE document_id = ? AND vector_id IS NOT NULL", (doc_id,))
                vector_ids = [row[0] for row in cursor.fetchall()]
                
                return vector_ids
                
        except Exception as e:
            logger.error(f"获取文件路径的向量ID失败: {str(e)}")
            return []

    def get_vector_ids_by_path_prefix(self, folder_path: str) -> List[int]:
        """根据文件夹路径前缀获取所有相关的向量ID"""
        try:
            with sqlite3.connect(self.db_path) as conn:
                cursor = conn.cursor()
                
                # 确保路径前缀格式正确（以/结尾）
                if not folder_path.endswith('/'):
                    folder_path += '/'
                
                # 获取所有匹配的向量ID
                cursor.execute("""
                    SELECT dc.vector_id 
                    FROM documents d
                    JOIN document_chunks dc ON d.id = dc.document_id
                    WHERE d.file_path LIKE ? AND dc.vector_id IS NOT NULL
                """, (f"{folder_path}%",))
                
                vector_ids = [row[0] for row in cursor.fetchall()]
                
                return vector_ids
                
        except Exception as e:
            logger.error(f"获取文件夹路径前缀的向量ID失败: {str(e)}")
            return []
    
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