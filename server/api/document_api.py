from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional
import logging
import hashlib
import pathlib
from datetime import datetime
from typing import Dict, Any
from service.embedding_service import get_embedding_service
from service.faiss_service import FaissManager
from service.sqlite_service import SQLiteManager
from service.text_splitter_service import init_text_splitter_service, get_text_splitter_service
from config.config import ServerConfig
from model.document_request_model import (
    FileUploadRequest,
    FileUploadResponse
)

class UpdateDocumentPathRequest(BaseModel):
    """更新文档路径请求模型"""
    old_path: str
    new_path: str
    is_folder: bool = False

class DeleteDocumentRequest(BaseModel):
    """删除文档请求模型"""
    file_path: str
    is_folder: bool = False

class DeleteDocumentResponse(BaseModel):
    """删除文档响应模型"""
    status: str
    message: str
    deleted_documents: int
    deleted_vectors: int

class DocumentExistsRequest(BaseModel):
    """检查文档是否存在请求模型"""
    file_path: str

class DocumentExistsResponse(BaseModel):
    """检查文档是否存在响应模型"""
    exists: bool
    document_id: Optional[int] = None

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/document", tags=["document"])

# 全局变量
faiss_manager = None
sqlite_manager = None
text_splitter_service = None

def init_document_api(faiss_mgr: FaissManager, sqlite_mgr: SQLiteManager):
    """初始化文档API"""
    global faiss_manager, sqlite_manager, text_splitter_service
    faiss_manager = faiss_mgr
    sqlite_manager = sqlite_mgr
    
    # 初始化文本分割服务
    if ServerConfig.TEXT_SPLITTER_TYPE == "recursive":
        init_text_splitter_service(
            "recursive",
            chunk_size=ServerConfig.RECURSIVE_CHUNK_SIZE,
            chunk_overlap=ServerConfig.RECURSIVE_CHUNK_OVERLAP,
            separators=ServerConfig.RECURSIVE_SEPARATORS
        )
    else:  # semantic
        init_text_splitter_service(
            "semantic",
            breakpoint_threshold_type=ServerConfig.SEMANTIC_BREAKPOINT_THRESHOLD_TYPE,
            breakpoint_threshold_amount=ServerConfig.SEMANTIC_BREAKPOINT_THRESHOLD_AMOUNT
        )
    
    text_splitter_service = get_text_splitter_service()
    logger.info(f"Document API initialized with {text_splitter_service.get_splitter_info()['type']} text splitter")

@router.post("/upload", response_model=FileUploadResponse)
async def upload_document(request: FileUploadRequest):
    """
    上传文档到系统
    
    Args:
        request: 文件上传请求，包含文件路径
        
    Returns:
        上传结果，包括状态、消息和文档信息
    """
    try:
        logger.info(f"收到文件上传请求: {request.file_path}")
        
        # 1. 验证文件路径
        file_path = pathlib.Path(request.file_path)
        if not file_path.exists():
            raise HTTPException(status_code=404, detail=f"文件不存在: {request.file_path}")
        
        if not file_path.is_file():
            raise HTTPException(status_code=400, detail=f"路径不是文件: {request.file_path}")
        
        # 2. 获取项目根目录
        project_root = ServerConfig.PROJECT_ROOT
        
        # 验证文件是否在项目根目录内
        try:
            file_path.relative_to(project_root)
        except ValueError:
            raise HTTPException(status_code=400, detail=f"文件必须在项目根目录内: {project_root}")
        
        # 获取文件名和类型
        filename = file_path.name
        file_type = file_path.suffix.lower().lstrip('.')
        logger.info(f"文件信息: 名称={filename}, 类型={file_type}")
        
        # 3. 计算文件哈希值检查是否已上传
        file_hash = calculate_file_hash(file_path)
        relative_file_path = str(file_path.relative_to(project_root))
        
        # 使用新的复合校验逻辑：同时检查文件路径和哈希
        if sqlite_manager:
            # 首先检查完全相同的文件路径和哈希（同一文件）
            existing_doc = sqlite_manager.get_document_by_path_and_hash(relative_file_path, file_hash)
            if existing_doc:
                # 检查是否已有块记录，如果没有则重新处理
                existing_chunks = sqlite_manager.get_document_chunks(existing_doc['id'])
                if not existing_chunks:
                    logger.info(f"文件已存在但无块记录，重新处理文档ID: {existing_doc['id']}")
                    # 继续执行后续的分割、嵌入等操作，但使用现有文档ID
                    document_id = existing_doc['id']
                    # 跳过文档插入步骤，继续执行后续步骤
                else:
                    return FileUploadResponse(
                        status="exists",
                        message=f"文件已存在，文档ID: {existing_doc['id']}",
                        document_id=existing_doc['id'],
                        file_info={
                            "filename": filename,
                            "file_type": file_type,
                            "file_hash": file_hash,
                            "file_size": file_path.stat().st_size
                        }
                    )
            else:
                # 检查是否有相同哈希但不同路径的文件（文件内容相同但位置不同）
                same_hash_docs = sqlite_manager.get_documents_by_hash(file_hash)
                if same_hash_docs:
                    # 文件内容相同但路径不同，可能是文件被移动了
                    logger.warning(f"发现相同哈希但不同路径的文件，可能是文件移动: {file_hash}")
                    
                    # 检查原文件是否还存在磁盘上
                    existing_doc = same_hash_docs[0]  # 取最新的一个
                    original_full_path = project_root / existing_doc['file_path']
                    
                    if original_full_path.exists():
                        # 原文件还存在，说明是不同位置的相同文件，拒绝上传
                        return FileUploadResponse(
                            status="exists",
                            message=f"相同内容的文件已存在于: {existing_doc['file_path']}",
                            document_id=existing_doc['id'],
                            file_info={
                                "filename": filename,
                                "file_type": file_type,
                                "file_hash": file_hash,
                                "file_size": file_path.stat().st_size,
                                "existing_path": existing_doc['file_path']
                            }
                        )
                    else:
                        # 原文件不存在，可能是文件被移动了，更新路径信息
                        logger.info(f"检测到文件移动，从 {existing_doc['file_path']} 到 {relative_file_path}")
                        
                        # 更新文档路径信息
                        sqlite_manager.update_document_path(existing_doc['file_path'], relative_file_path)
                        
                        # 更新Faiss向量元数据中的路径信息
                        if faiss_manager:
                            faiss_manager.update_metadata_by_path(existing_doc['file_path'], relative_file_path)
                        
                        return FileUploadResponse(
                            status="updated",
                            message=f"文件路径已更新: {existing_doc['file_path']} -> {relative_file_path}",
                            document_id=existing_doc['id'],
                            file_info={
                                "filename": filename,
                                "file_type": file_type,
                                "file_hash": file_hash,
                                "file_size": file_path.stat().st_size,
                                "old_path": existing_doc['file_path'],
                                "new_path": relative_file_path
                            }
                        )
        
        # 4. 根据文档类型提取文本（目前只支持txt）
        if file_type != "txt":
            raise HTTPException(status_code=400, detail=f"暂不支持的文件类型: {file_type}")
        
        try:
            with open(file_path, 'r', encoding='utf-8') as f:
                text_content = f.read()
        except UnicodeDecodeError:
            try:
                with open(file_path, 'r', encoding='gbk') as f:
                    text_content = f.read()
            except UnicodeDecodeError:
                raise HTTPException(status_code=400, detail="无法读取文件，编码格式不支持")
        
        if not text_content.strip():
            raise HTTPException(status_code=400, detail="文件内容为空")
        
        logger.info(f"文本提取完成，长度: {len(text_content)}")
        
        # 5. 分割文本
        if not text_splitter_service:
            raise HTTPException(status_code=500, detail="文本分割器未初始化")
        
        # 使用配置的文本分割器分割文本
        chunks = text_splitter_service.split_text(text_content)
        splitter_info = text_splitter_service.get_splitter_info()
        logger.info(f"文本分割完成，共 {len(chunks)} 个块，分割器类型: {splitter_info['type']}")
        
        if not chunks:
            raise HTTPException(status_code=400, detail="文本分割后无有效内容")
        
        # 6. 存储文档到SQLite数据库
        if not sqlite_manager:
            raise HTTPException(status_code=500, detail="数据库管理器未初始化")
        
        # 检查是否是重新处理的情况
        is_reprocessing = False
        if 'document_id' in locals():
            is_reprocessing = True
            logger.info(f"重新处理文档，文档ID: {document_id}")
            # 清理现有的块和向量数据
            sqlite_manager.delete_document_by_path(str(file_path.relative_to(project_root)))
            # 重新插入文档记录
            document_id = sqlite_manager.insert_document(
                filename=filename,
                file_path=str(file_path.relative_to(project_root)),
                file_type=file_type,
                file_size=file_path.stat().st_size,
                file_hash=file_hash,
                content=text_content,
                metadata={
                    "upload_time": datetime.now().isoformat(),
                    "chunks_count": len(chunks),
                    "original_path": request.file_path
                }
            )
        else:
            # 新文档，正常插入
            document_id = sqlite_manager.insert_document(
                filename=filename,
                file_path=str(file_path.relative_to(project_root)),
                file_type=file_type,
                file_size=file_path.stat().st_size,
                file_hash=file_hash,
                content=text_content,
                metadata={
                    "upload_time": datetime.now().isoformat(),
                    "chunks_count": len(chunks),
                    "original_path": request.file_path
                }
            )
            logger.info(f"文档已存储到SQLite，文档ID: {document_id}")
        
        # 7. 生成文本嵌入向量
        embedding_service = get_embedding_service()
        if not embedding_service:
            raise HTTPException(status_code=500, detail="嵌入服务未初始化")
        
        # 为每个文本块生成嵌入向量
        embeddings = []
        for i, chunk in enumerate(chunks):
            try:
                embedding = embedding_service.encode_text(chunk)
                embeddings.append(embedding)
                logger.debug(f"已生成第 {i+1} 个文本块的嵌入向量")
            except Exception as e:
                logger.error(f"生成嵌入向量失败: {str(e)}")
                raise HTTPException(status_code=500, detail=f"生成嵌入向量失败: {str(e)}")
        
        logger.info(f"嵌入向量生成完成，共 {len(embeddings)} 个向量")
        
        # 8. 存储向量到Faiss索引
        if not faiss_manager:
            raise HTTPException(status_code=500, detail="Faiss管理器未初始化")
        
        # 为每个向量准备元数据
        vector_metadata = []
        for i, (chunk, embedding) in enumerate(zip(chunks, embeddings)):
            metadata = {
                "document_id": document_id,
                "chunk_index": i,
                "chunk_text": chunk[:200] + "..." if len(chunk) > 200 else chunk,  # 存储前200字符作为预览
                "chunk_size": len(chunk),
                "file_path": str(file_path.relative_to(project_root)),
                "filename": filename,
                "file_type": file_type
            }
            vector_metadata.append(metadata)
        
        # 批量添加向量到索引
        import numpy as np
        embeddings_array = np.array(embeddings, dtype=np.float32)
        vector_ids = faiss_manager.add_vectors(embeddings_array, vector_metadata)
        logger.info(f"向量已存储到Faiss索引，向量ID列表: {vector_ids}")
        
        # 9. 存储文本块信息到数据库
        chunk_ids = []
        for i, (chunk, vector_id) in enumerate(zip(chunks, vector_ids)):
            chunk_id = sqlite_manager.insert_chunk(
                document_id=document_id,
                chunk_index=i,
                content=chunk,
                vector_id=vector_id
            )
            chunk_ids.append(chunk_id)
        
        logger.info(f"文本块信息已存储到数据库，块ID列表: {chunk_ids}")
        
        # 10. 返回上传结果
        return FileUploadResponse(
            status="success",
            message=f"文档上传成功，文档ID: {document_id}",
            document_id=document_id,
            file_info={
                "filename": filename,
                "file_type": file_type,
                "file_hash": file_hash,
                "file_size": file_path.stat().st_size,
                "chunks_count": len(chunks),
                "vector_count": len(vector_ids)
            }
        )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"文档上传失败: {str(e)}")
        raise HTTPException(status_code=500, detail=f"文档上传失败: {str(e)}")

@router.post("/update-path")
async def update_document_path(request: UpdateDocumentPathRequest):
    """
    更新文档路径
    
    Args:
        request: 更新路径请求，包含旧路径和新路径
        
    Returns:
        更新结果
    """
    try:
        logger.info(f"收到路径更新请求: {request.old_path} -> {request.new_path}")
        
        if not sqlite_manager:
            raise HTTPException(status_code=500, detail="数据库管理器未初始化")
        
        # 验证路径参数
        if not request.old_path or not request.new_path:
            raise HTTPException(status_code=400, detail="路径参数不能为空")
        
        # 标准化路径（移除前导斜杠）
        old_path = request.old_path.lstrip('/')
        new_path = request.new_path.lstrip('/')
        
        # 根据是否是文件夹选择不同的更新方法
        if request.is_folder:
            # 更新文件夹下所有文档的路径
            updated_count = sqlite_manager.update_documents_by_path_prefix(old_path, new_path)
            logger.info(f"文件夹路径更新完成，更新了 {updated_count} 个文档")
        else:
            # 更新单个文档路径
            updated_count = sqlite_manager.update_document_path(old_path, new_path)
            logger.info(f"文档路径更新完成，更新了 {updated_count} 个文档")
        
        if updated_count > 0:
            return {
                "status": "success",
                "message": f"成功更新了 {updated_count} 个文档的路径",
                "updated_documents": updated_count
            }
        else:
            return {
                "status": "not_found", 
                "message": "未找到需要更新路径的文档",
                "updated_documents": 0
            }
            
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"更新文档路径失败: {str(e)}")
        raise HTTPException(status_code=500, detail=f"更新文档路径失败: {str(e)}")

@router.delete("/delete", response_model=DeleteDocumentResponse)
async def delete_document(request: DeleteDocumentRequest):
    """
    删除文档及相关数据
    
    Args:
        request: 删除文档请求，包含文件路径和是否为文件夹
        
    Returns:
        删除结果，包括删除的文档数量和向量数量
    """
    try:
        logger.info(f"收到文档删除请求: {request.file_path}, 文件夹: {request.is_folder}")
        
        if not sqlite_manager or not faiss_manager:
            raise HTTPException(status_code=500, detail="数据库管理器未初始化")
        
        # 验证路径参数
        if not request.file_path:
            raise HTTPException(status_code=400, detail="文件路径不能为空")
        
        # 标准化路径（移除前导斜杠）
        file_path = request.file_path.lstrip('/')
        
        deleted_docs = 0
        deleted_vectors = 0
        
        if request.is_folder:
            # 删除文件夹及其下所有文档
            logger.info(f"开始递归删除文件夹: {file_path}")
            
            # 1. 获取文件夹下所有文档的向量ID
            vector_ids = sqlite_manager.get_vector_ids_by_path_prefix(file_path)
            logger.info(f"找到 {len(vector_ids)} 个向量需要删除")
            
            # 2. 从SQLite中删除文档及相关数据
            deleted_docs = sqlite_manager.delete_documents_by_path_prefix(file_path)
            logger.info(f"从SQLite中删除了 {deleted_docs} 个文档")
            
            # 3. 从Faiss中删除向量
            if vector_ids:
                deleted_vectors = faiss_manager.delete_vectors_by_ids(vector_ids)
                logger.info(f"从Faiss中删除了 {deleted_vectors} 个向量")
            
        else:
            # 删除单个文档
            logger.info(f"开始删除单个文档: {file_path}")
            
            # 1. 获取文档的向量ID
            vector_ids = sqlite_manager.get_vector_ids_by_path(file_path)
            logger.info(f"找到 {len(vector_ids)} 个向量需要删除")
            
            # 2. 从SQLite中删除文档及相关数据
            deleted_docs = sqlite_manager.delete_document_by_path(file_path)
            logger.info(f"从SQLite中删除了 {deleted_docs} 个文档")
            
            # 3. 从Faiss中删除向量
            if vector_ids:
                deleted_vectors = faiss_manager.delete_vectors_by_ids(vector_ids)
                logger.info(f"从Faiss中删除了 {deleted_vectors} 个向量")
        
        return DeleteDocumentResponse(
            status="success",
            message=f"成功删除了 {deleted_docs} 个文档和 {deleted_vectors} 个向量",
            deleted_documents=deleted_docs,
            deleted_vectors=deleted_vectors
        )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"删除文档失败: {str(e)}")
        raise HTTPException(status_code=500, detail=f"删除文档失败: {str(e)}")

def calculate_file_hash(file_path: pathlib.Path) -> str:
    """计算文件哈希值"""
    hash_sha256 = hashlib.sha256()
    with open(file_path, "rb") as f:
        for chunk in iter(lambda: f.read(4096), b""):
            hash_sha256.update(chunk)
    return hash_sha256.hexdigest()