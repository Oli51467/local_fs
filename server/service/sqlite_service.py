import sqlite3
import json
import logging
import pathlib
from datetime import datetime
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
            conn.row_factory = sqlite3.Row
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

            # 创建文档图片表
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS document_images (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    document_id INTEGER NOT NULL,
                    chunk_index INTEGER,
                    line_number INTEGER,
                    image_name TEXT NOT NULL,
                    image_format TEXT NOT NULL,
                    image_size INTEGER NOT NULL,
                    width INTEGER,
                    height INTEGER,
                    storage_path TEXT NOT NULL,
                    storage_folder TEXT NOT NULL,
                    source_path TEXT,
                    upload_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    vector_id INTEGER,
                    FOREIGN KEY (document_id) REFERENCES documents (id) ON DELETE CASCADE
                )
            """)

            cursor.execute("CREATE INDEX IF NOT EXISTS idx_images_document ON document_images(document_id)")
            cursor.execute("CREATE INDEX IF NOT EXISTS idx_images_vector ON document_images(vector_id)")
            cursor.execute("CREATE INDEX IF NOT EXISTS idx_images_folder ON document_images(storage_folder)")

            # 创建对话会话与消息表
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS conversations (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    title TEXT NOT NULL,
                    created_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    messages_json TEXT DEFAULT '[]',
                    message_seq INTEGER DEFAULT 0
                )
            """)

            cursor.execute("""
                CREATE TABLE IF NOT EXISTS chat_messages (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    conversation_id INTEGER NOT NULL,
                    role TEXT NOT NULL,
                    content TEXT NOT NULL,
                    metadata TEXT,
                    created_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (conversation_id) REFERENCES conversations (id) ON DELETE CASCADE
                )
            """)

            cursor.execute("CREATE INDEX IF NOT EXISTS idx_chat_messages_conversation ON chat_messages(conversation_id)")
            cursor.execute("CREATE INDEX IF NOT EXISTS idx_conversations_updated ON conversations(updated_time)")

            cursor.execute("PRAGMA table_info(conversations)")
            existing_columns = {row[1] for row in cursor.fetchall()}
            if 'messages_json' not in existing_columns:
                cursor.execute("ALTER TABLE conversations ADD COLUMN messages_json TEXT DEFAULT '[]'")
            if 'message_seq' not in existing_columns:
                cursor.execute("ALTER TABLE conversations ADD COLUMN message_seq INTEGER DEFAULT 0")
            cursor.execute("UPDATE conversations SET messages_json = '[]' WHERE messages_json IS NULL")
            cursor.execute("UPDATE conversations SET message_seq = 0 WHERE message_seq IS NULL")

            cursor.execute(
                """
                CREATE TABLE IF NOT EXISTS message_registry (
                    id INTEGER PRIMARY KEY CHECK (id = 1),
                    last_message_id INTEGER NOT NULL DEFAULT 0
                )
                """
            )
            cursor.execute(
                "INSERT OR IGNORE INTO message_registry (id, last_message_id) VALUES (1, 0)"
            )

            cursor.execute(
                "SELECT COUNT(*) FROM conversations WHERE messages_json IS NOT NULL AND messages_json != '[]'"
            )
            populated_conversations = cursor.fetchone()[0]
            if populated_conversations == 0:
                cursor.execute(
                    """
                    SELECT id, conversation_id, role, content, metadata, created_time
                    FROM chat_messages
                    ORDER BY conversation_id ASC, created_time ASC, id ASC
                    """
                )
                rows = cursor.fetchall()
                if rows:
                    conversations_payload = {}
                    last_message_id = 0
                    for row in rows:
                        conv_id = row['conversation_id']
                        try:
                            metadata = json.loads(row['metadata']) if row['metadata'] else None
                        except json.JSONDecodeError:
                            metadata = None
                        message = {
                            'id': row['id'],
                            'conversation_id': conv_id,
                            'role': row['role'],
                            'content': row['content'],
                            'metadata': metadata,
                            'created_time': row['created_time']
                        }
                        conversations_payload.setdefault(conv_id, []).append(message)
                        last_message_id = max(last_message_id, row['id'])

                    for conv_id, messages in conversations_payload.items():
                        cursor.execute(
                            """
                            UPDATE conversations
                            SET messages_json = ?, message_seq = ?, updated_time = COALESCE(updated_time, CURRENT_TIMESTAMP)
                            WHERE id = ?
                            """,
                            (json.dumps(messages, ensure_ascii=False), len(messages), conv_id)
                        )

                    cursor.execute(
                        "UPDATE message_registry SET last_message_id = ? WHERE id = 1",
                        (last_message_id,)
                    )
            
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

    def insert_document_image(
        self,
        document_id: int,
        *,
        chunk_index: Optional[int],
        line_number: Optional[int],
        image_name: str,
        image_format: str,
        image_size: int,
        width: Optional[int],
        height: Optional[int],
        storage_path: str,
        storage_folder: str,
        source_path: Optional[str],
        vector_id: Optional[int]
    ) -> int:
        """插入文档图片元数据记录"""
        with sqlite3.connect(self.db_path) as conn:
            cursor = conn.cursor()
            cursor.execute(
                """
                INSERT INTO document_images (
                    document_id,
                    chunk_index,
                    line_number,
                    image_name,
                    image_format,
                    image_size,
                    width,
                    height,
                    storage_path,
                    storage_folder,
                    source_path,
                    vector_id
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    document_id,
                    chunk_index,
                    line_number,
                    image_name,
                    image_format,
                    image_size,
                    width,
                    height,
                    storage_path,
                    storage_folder,
                    source_path,
                    vector_id,
                ),
            )
            return cursor.lastrowid

    def get_image_vector_records(
        self,
        *,
        limit: int = 100,
        offset: int = 0,
        search: Optional[str] = None
    ) -> Dict[str, Any]:
        """分页获取图片向量记录及其所属文档信息"""
        if limit <= 0:
            limit = 100
        if limit > 500:
            limit = 500
        if offset < 0:
            offset = 0

        with sqlite3.connect(self.db_path) as conn:
            conn.row_factory = sqlite3.Row
            cursor = conn.cursor()

            base_query = """
                FROM document_images di
                LEFT JOIN documents d ON di.document_id = d.id
            """

            where_clauses: List[str] = []
            params: List[Any] = []

            if search:
                search_like = f"%{search.strip()}%"
                where_clauses.append(
                    "(d.filename LIKE ? OR d.file_path LIKE ? OR di.image_name LIKE ? OR di.storage_path LIKE ?)"
                )
                params.extend([search_like, search_like, search_like, search_like])

            where_sql = f"WHERE {' AND '.join(where_clauses)}" if where_clauses else ""

            count_query = f"SELECT COUNT(*) {base_query} {where_sql}"
            cursor.execute(count_query, params)
            total = cursor.fetchone()[0]

            query = f"""
                SELECT
                    di.id AS image_id,
                    di.document_id,
                    di.image_name,
                    di.image_format,
                    di.image_size,
                    di.width,
                    di.height,
                    di.line_number,
                    di.storage_path,
                    di.storage_folder,
                    di.source_path,
                    di.upload_time AS image_upload_time,
                    di.vector_id,
                    d.filename,
                    d.file_path,
                    d.file_type,
                    d.file_size,
                    d.upload_time AS document_upload_time
                {base_query}
                {where_sql}
                ORDER BY di.upload_time DESC, di.id DESC
                LIMIT ? OFFSET ?
            """

            query_params = params + [limit, offset]
            cursor.execute(query, query_params)
            rows = cursor.fetchall()

            records: List[Dict[str, Any]] = []
            for row in rows:
                record = {key: row[key] for key in row.keys()}
                records.append(record)

            stats = self.get_image_vector_statistics(cursor)

        return {
            "total": total,
            "limit": limit,
            "offset": offset,
            "records": records,
            "stats": stats
        }

    def get_image_vector_statistics(self, cursor: sqlite3.Cursor = None) -> Dict[str, Any]:
        """获取图片向量统计信息"""
        close_cursor = False
        if cursor is None:
            conn = sqlite3.connect(self.db_path)
            cursor = conn.cursor()
            close_cursor = True
        else:
            conn = None

        try:
            cursor.execute("SELECT COUNT(*), IFNULL(SUM(image_size), 0), COUNT(DISTINCT document_id) FROM document_images")
            total_count, total_size, doc_count = cursor.fetchone()

            cursor.execute("SELECT image_format, COUNT(*) FROM document_images GROUP BY image_format")
            format_rows = cursor.fetchall()
            format_counts = {row[0]: row[1] for row in format_rows if row[0]}

            return {
                "total_count": total_count,
                "total_size": total_size,
                "document_count": doc_count,
                "format_breakdown": format_counts
            }
        finally:
            if close_cursor and conn is not None:
                conn.close()
    
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

    def get_document_by_path(self, file_path: str) -> Optional[Dict]:
        """根据文件路径获取文档"""
        with sqlite3.connect(self.db_path) as conn:
            cursor = conn.cursor()
            cursor.execute("""
                SELECT id, filename, file_path, file_type, file_size, 
                       upload_time, content_hash, total_chunks
                FROM documents 
                WHERE file_path = ?
                ORDER BY upload_time DESC
                LIMIT 1
            """, (file_path,))
            
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

    def get_document_by_id(self, document_id: int) -> Optional[Dict]:
        """根据文档ID获取文档"""
        with sqlite3.connect(self.db_path) as conn:
            cursor = conn.cursor()
            cursor.execute("""
                SELECT id, filename, file_path, file_type, file_size,
                       upload_time, content_hash, total_chunks
                FROM documents
                WHERE id = ?
                LIMIT 1
            """, (document_id,))

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

    def search_chunks_by_substring(self, query: str) -> List[Dict[str, Any]]:
        """检索包含指定子串的全部文档块。"""
        if not query:
            return []

        # 处理通配符，避免用户输入影响 LIKE 模式
        escaped = query.replace('\\', '\\\\').replace('%', '\\%').replace('_', '\\_')
        pattern = f"%{escaped}%"

        with sqlite3.connect(self.db_path) as conn:
            conn.row_factory = sqlite3.Row
            cursor = conn.cursor()
            try:
                cursor.execute(
                    """
                    SELECT
                        dc.id AS chunk_id,
                        dc.document_id,
                        dc.chunk_index,
                        dc.content,
                        dc.vector_id,
                        d.filename,
                        d.file_path,
                        d.file_type,
                        d.upload_time
                    FROM document_chunks dc
                    JOIN documents d ON d.id = dc.document_id
                    WHERE dc.content LIKE ? ESCAPE '\\' COLLATE NOCASE
                    ORDER BY d.upload_time DESC, dc.chunk_index
                    """,
                    (pattern,)
                )
            except Exception as exc:
                logger.warning("搜索文档块时出错: %s", exc)
                return []

            rows = cursor.fetchall()
            results: List[Dict[str, Any]] = []
            for row in rows:
                results.append({
                    'chunk_id': row['chunk_id'],
                    'document_id': row['document_id'],
                    'chunk_index': row['chunk_index'],
                    'content': row['content'],
                    'vector_id': row['vector_id'],
                    'filename': row['filename'],
                    'file_path': row['file_path'],
                    'file_type': row['file_type'],
                    'upload_time': row['upload_time'],
                })
            return results

    def get_documents_by_paths(self, file_paths: List[str]) -> List[str]:
        """批量根据文件路径获取已存在的文档路径"""
        if not file_paths:
            return []

        placeholders = ",".join(["?"] * len(file_paths))
        query = f"SELECT file_path FROM documents WHERE file_path IN ({placeholders})"

        with sqlite3.connect(self.db_path) as conn:
            cursor = conn.cursor()
            cursor.execute(query, file_paths)
            return [row[0] for row in cursor.fetchall()]

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

    def get_image_vector_ids_by_path(self, file_path: str) -> List[int]:
        """根据文件路径获取所有相关的图片向量ID"""
        try:
            with sqlite3.connect(self.db_path) as conn:
                cursor = conn.cursor()

                cursor.execute("SELECT id FROM documents WHERE file_path = ?", (file_path,))
                result = cursor.fetchone()
                if not result:
                    return []

                doc_id = result[0]
                cursor.execute(
                    "SELECT vector_id FROM document_images WHERE document_id = ? AND vector_id IS NOT NULL",
                    (doc_id,),
                )
                return [row[0] for row in cursor.fetchall()]

        except Exception as e:
            logger.error(f"获取文件路径的图片向量ID失败: {str(e)}")
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

    def get_image_vector_ids_by_path_prefix(self, folder_path: str) -> List[int]:
        """根据文件夹路径前缀获取所有相关的图片向量ID"""
        try:
            with sqlite3.connect(self.db_path) as conn:
                cursor = conn.cursor()

                if not folder_path.endswith('/'):
                    folder_path += '/'

                cursor.execute(
                    """
                    SELECT di.vector_id
                    FROM documents d
                    JOIN document_images di ON d.id = di.document_id
                    WHERE d.file_path LIKE ? AND di.vector_id IS NOT NULL
                    """,
                    (f"{folder_path}%",),
                )

                return [row[0] for row in cursor.fetchall()]

        except Exception as e:
            logger.error(f"获取文件夹路径前缀的图片向量ID失败: {str(e)}")
            return []

    def get_image_storage_folders_by_path(self, file_path: str) -> List[str]:
        """获取指定文件的图片存储文件夹路径列表"""
        try:
            with sqlite3.connect(self.db_path) as conn:
                cursor = conn.cursor()

                cursor.execute("SELECT id FROM documents WHERE file_path = ?", (file_path,))
                result = cursor.fetchone()
                if not result:
                    return []

                doc_id = result[0]
                cursor.execute(
                    "SELECT DISTINCT storage_folder FROM document_images WHERE document_id = ?",
                    (doc_id,),
                )
                return [row[0] for row in cursor.fetchall() if row[0]]

        except Exception as e:
            logger.error(f"获取文件图片存储文件夹失败: {str(e)}")
            return []

    def get_image_storage_folders_by_path_prefix(self, folder_path: str) -> List[str]:
        """获取指定文件夹路径前缀对应的所有图片存储文件夹"""
        try:
            with sqlite3.connect(self.db_path) as conn:
                cursor = conn.cursor()

                if not folder_path.endswith('/'):
                    folder_path += '/'

                cursor.execute(
                    """
                    SELECT DISTINCT di.storage_folder
                    FROM documents d
                    JOIN document_images di ON d.id = di.document_id
                    WHERE d.file_path LIKE ?
                    """,
                    (f"{folder_path}%",),
                )

                return [row[0] for row in cursor.fetchall() if row[0]]

        except Exception as e:
            logger.error(f"获取文件夹图片存储文件夹失败: {str(e)}")
            return []

    # 会话与消息管理

    def create_conversation(self, title: str) -> int:
        """创建新的对话会话"""
        normalized_title = (title or '').strip()
        if not normalized_title:
            normalized_title = '新对话'

        with sqlite3.connect(self.db_path) as conn:
            cursor = conn.cursor()
            cursor.execute(
                """
                INSERT INTO conversations (title, messages_json, message_seq)
                VALUES (?, '[]', 0)
                """,
                (normalized_title,)
            )
            return cursor.lastrowid

    def update_conversation_title(self, conversation_id: int, title: str) -> bool:
        """更新对话会话标题"""
        normalized_title = (title or '').strip()
        if not normalized_title:
            return False

        with sqlite3.connect(self.db_path) as conn:
            cursor = conn.cursor()
            cursor.execute(
                """
                UPDATE conversations
                SET title = ?, updated_time = CURRENT_TIMESTAMP
                WHERE id = ?
                """,
                (normalized_title, conversation_id)
            )
            return cursor.rowcount > 0

    def touch_conversation(self, conversation_id: int) -> None:
        """更新会话的更新时间戳"""
        with sqlite3.connect(self.db_path) as conn:
            cursor = conn.cursor()
            cursor.execute(
                "UPDATE conversations SET updated_time = CURRENT_TIMESTAMP WHERE id = ?",
                (conversation_id,)
            )

    def delete_conversation(self, conversation_id: int) -> bool:
        """删除指定会话及其关联消息"""
        with sqlite3.connect(self.db_path) as conn:
            conn.execute("PRAGMA foreign_keys = ON")
            cursor = conn.cursor()
            cursor.execute(
                "DELETE FROM conversations WHERE id = ?",
                (conversation_id,)
            )
            return cursor.rowcount > 0

    def get_conversation_by_id(self, conversation_id: int) -> Optional[Dict[str, Any]]:
        """根据ID获取会话信息"""
        with sqlite3.connect(self.db_path) as conn:
            conn.row_factory = sqlite3.Row
            cursor = conn.cursor()
            cursor.execute(
                """
                SELECT id, title, created_time, updated_time
                FROM conversations
                WHERE id = ?
                """,
                (conversation_id,)
            )
            row = cursor.fetchone()
            if not row:
                return None
            return {
                'id': row['id'],
                'title': row['title'],
                'created_time': row['created_time'],
                'updated_time': row['updated_time']
            }

    def list_conversations(self) -> List[Dict[str, Any]]:
        """获取所有会话列表，按更新时间倒序排列"""
        with sqlite3.connect(self.db_path) as conn:
            conn.row_factory = sqlite3.Row
            cursor = conn.cursor()
            cursor.execute(
                """
                SELECT id, title, created_time, updated_time, messages_json
                FROM conversations
                ORDER BY updated_time DESC, id DESC
                """
            )

            conversations = []
            for row in cursor.fetchall():
                messages_raw = row['messages_json'] or '[]'
                try:
                    messages = json.loads(messages_raw)
                except json.JSONDecodeError:
                    messages = []
                last_message = messages[-1] if messages else None
                conversations.append({
                    'id': row['id'],
                    'title': row['title'],
                    'created_time': row['created_time'],
                    'updated_time': row['updated_time'],
                    'last_message': last_message.get('content') if last_message else None,
                    'last_role': last_message.get('role') if last_message else None,
                    'message_count': len(messages)
                })

            return conversations

    def insert_chat_message(
        self,
        conversation_id: int,
        role: str,
        content: str,
        metadata: Optional[Dict[str, Any]] = None
    ) -> int:
        """插入一条聊天消息，并更新会话更新时间"""
        stored_metadata = None
        if metadata is not None:
            try:
                stored_metadata = json.loads(json.dumps(metadata, ensure_ascii=False))
            except (TypeError, ValueError) as exc:
                logger.warning('消息元数据无法序列化，将被忽略: %s', exc)
                stored_metadata = None

        timestamp = datetime.utcnow().isoformat() + 'Z'

        with sqlite3.connect(self.db_path) as conn:
            conn.row_factory = sqlite3.Row
            cursor = conn.cursor()
            cursor.execute(
                "SELECT messages_json, message_seq FROM conversations WHERE id = ?",
                (conversation_id,)
            )
            row = cursor.fetchone()
            if not row:
                raise ValueError(f"Conversation {conversation_id} does not exist")

            messages_raw = row['messages_json'] or '[]'
            try:
                messages = json.loads(messages_raw)
            except json.JSONDecodeError:
                messages = []

            cursor.execute("SELECT last_message_id FROM message_registry WHERE id = 1")
            registry_row = cursor.fetchone()
            last_global_id = registry_row['last_message_id'] if registry_row else 0
            next_global_id = int(last_global_id or 0) + 1
            cursor.execute(
                "UPDATE message_registry SET last_message_id = ? WHERE id = 1",
                (next_global_id,)
            )

            next_sequence = int(row['message_seq'] or 0) + 1
            message_record = {
                'id': next_global_id,
                'conversation_id': conversation_id,
                'role': role,
                'content': content,
                'metadata': stored_metadata,
                'created_time': timestamp
            }
            messages.append(message_record)

            cursor.execute(
                """
                UPDATE conversations
                SET messages_json = ?, message_seq = ?, updated_time = CURRENT_TIMESTAMP
                WHERE id = ?
                """,
                (json.dumps(messages, ensure_ascii=False), next_sequence, conversation_id)
            )

            return next_global_id

    def update_chat_message(
        self,
        message_id: int,
        content: Optional[str] = None,
        metadata: Optional[Dict[str, Any]] = None,
        conversation_id: Optional[int] = None
    ) -> None:
        """更新聊天消息内容或元信息"""
        if content is None and metadata is None:
            return

        sanitized_metadata = None
        if metadata is not None:
            try:
                sanitized_metadata = json.loads(json.dumps(metadata, ensure_ascii=False))
            except (TypeError, ValueError) as exc:
                logger.warning('消息元数据更新失败，无法序列化: %s', exc)
                sanitized_metadata = None

        with sqlite3.connect(self.db_path) as conn:
            conn.row_factory = sqlite3.Row
            cursor = conn.cursor()

            target_row = None
            target_conversation_id = conversation_id
            if target_conversation_id is not None:
                cursor.execute(
                    "SELECT id, messages_json FROM conversations WHERE id = ?",
                    (target_conversation_id,)
                )
                target_row = cursor.fetchone()
            else:
                cursor.execute("SELECT id, messages_json FROM conversations")
                for row in cursor.fetchall():
                    messages_raw = row['messages_json'] or '[]'
                    try:
                        messages = json.loads(messages_raw)
                    except json.JSONDecodeError:
                        continue
                    if any(msg.get('id') == message_id for msg in messages):
                        target_row = row
                        target_conversation_id = row['id']
                        break

            if not target_row or target_conversation_id is None:
                return

            messages_raw = target_row['messages_json'] or '[]'
            try:
                messages = json.loads(messages_raw)
            except json.JSONDecodeError:
                messages = []

            updated = False
            for message in messages:
                if message.get('id') == message_id:
                    if content is not None:
                        message['content'] = content
                    if metadata is not None:
                        message['metadata'] = sanitized_metadata
                    updated = True
                    break

            if not updated:
                return

            cursor.execute(
                """
                UPDATE conversations
                SET messages_json = ?, updated_time = CURRENT_TIMESTAMP
                WHERE id = ?
                """,
                (json.dumps(messages, ensure_ascii=False), target_conversation_id)
            )

    def get_conversation_messages(self, conversation_id: int) -> List[Dict[str, Any]]:
        """获取指定会话的全部消息，按时间顺序排序"""
        with sqlite3.connect(self.db_path) as conn:
            conn.row_factory = sqlite3.Row
            cursor = conn.cursor()
            cursor.execute(
                "SELECT messages_json FROM conversations WHERE id = ?",
                (conversation_id,)
            )
            row = cursor.fetchone()
            if not row:
                return []

            try:
                messages = json.loads(row['messages_json'] or '[]')
            except json.JSONDecodeError:
                messages = []

            for message in messages:
                message['conversation_id'] = conversation_id
            return messages

    def get_chat_message(self, message_id: int, conversation_id: Optional[int] = None) -> Optional[Dict[str, Any]]:
        """根据消息ID获取聊天消息"""
        with sqlite3.connect(self.db_path) as conn:
            conn.row_factory = sqlite3.Row
            cursor = conn.cursor()

            if conversation_id is not None:
                cursor.execute(
                    "SELECT id, messages_json FROM conversations WHERE id = ?",
                    (conversation_id,)
                )
                rows = cursor.fetchall()
            else:
                cursor.execute("SELECT id, messages_json FROM conversations")
                rows = cursor.fetchall()

            for row in rows:
                try:
                    messages = json.loads(row['messages_json'] or '[]')
                except json.JSONDecodeError:
                    continue
                for message in messages:
                    if message.get('id') == message_id:
                        message['conversation_id'] = row['id']
                        return message

            return None

    def cleanup_all(self):
        """清理所有数据"""
        try:
            with sqlite3.connect(self.db_path) as conn:
                cursor = conn.cursor()
                
                # 删除所有数据（保留表结构）
                cursor.execute("DELETE FROM chat_messages")
                cursor.execute("DELETE FROM conversations")
                cursor.execute("DELETE FROM document_chunks")
                cursor.execute("DELETE FROM document_images")
                cursor.execute("DELETE FROM documents")
                cursor.execute("UPDATE message_registry SET last_message_id = 0 WHERE id = 1")
                
                # 重置自增ID
                cursor.execute(
                    "DELETE FROM sqlite_sequence WHERE name IN ('documents', 'document_chunks', 'document_images', 'conversations', 'chat_messages')"
                )
                
                conn.commit()
                logger.info("SQLite数据库清理完成")
                
        except Exception as e:
            logger.error(f"SQLite数据库清理失败: {str(e)}")
            raise e
