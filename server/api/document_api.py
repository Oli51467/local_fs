from fastapi import APIRouter, HTTPException
import logging
import hashlib
import pathlib
from datetime import datetime
from service.embedding_service import get_embedding_service
from service.faiss_service import FaissManager
from service.sqlite_service import SQLiteManager
from service.langchain_embedding_service import BGEM3LangChainWrapper
from langchain_experimental.text_splitter import SemanticChunker
from model.document_request_model import (
    FileUploadRequest,
    FileUploadResponse
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/document", tags=["document"])

# 全局变量
faiss_manager = None
sqlite_manager = None
semantic_chunker = None

def init_document_api(faiss_mgr: FaissManager, sqlite_mgr: SQLiteManager):
    """初始化文档API"""
    global faiss_manager, sqlite_manager, semantic_chunker
    faiss_manager = faiss_mgr
    sqlite_manager = sqlite_mgr
    
    # 初始化语义分割器
    from pathlib import Path
    PROJECT_ROOT = Path(__file__).parent.parent.parent
    BGE_M3_MODEL_PATH = PROJECT_ROOT / "meta" / "embedding" / "bge-m3"
    
    embedding_model = BGEM3LangChainWrapper(BGE_M3_MODEL_PATH, use_fp16=True)
    semantic_chunker = SemanticChunker(
        embedding_model, 
        breakpoint_threshold_type="percentile",
        breakpoint_threshold_amount=90.0
    )
    
    logger.info("Document API initialized with SemanticChunker")


@router.post("/upload", response_model=FileUploadResponse)
async def upload_file(request: FileUploadRequest):
    """
    上传文件并处理
    """
    try:
        logger.info(f"开始处理文件上传请求: {request.file_path}")
        
        # 1. 确保上传目录存在并验证路径
        project_root = pathlib.Path(__file__).parent.parent.parent
        data_dir = project_root / "data"
        file_path = data_dir / request.file_path
        
        # 安全检查：确保文件在data目录下
        try:
            file_path = file_path.resolve()
            data_dir = data_dir.resolve()
            if not str(file_path).startswith(str(data_dir)):
                raise HTTPException(status_code=400, detail="文件路径必须在data目录下")
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"无效的文件路径: {str(e)}")
        
        # 检查文件是否存在
        if not file_path.exists():
            raise HTTPException(status_code=404, detail=f"文件不存在: {request.file_path}")
        
        if not file_path.is_file():
            raise HTTPException(status_code=400, detail=f"路径不是文件: {request.file_path}")
        
        # 2. 生成文件名和文件类型
        filename = file_path.name
        file_extension = file_path.suffix.lower()
        file_type = file_extension[1:] if file_extension else "unknown"
        
        logger.info(f"文件信息: 名称={filename}, 类型={file_type}")
        
        # 3. 计算文件哈希值检查是否已上传
        file_hash = calculate_file_hash(file_path)
        
        # 检查数据库中是否已存在相同哈希的文件
        if sqlite_manager:
            existing_docs = sqlite_manager.get_documents_by_filename(filename)
            for doc in existing_docs:
                if doc.get('file_hash') == file_hash:
                    return FileUploadResponse(
                        status="exists",
                        message=f"文件已存在，文档ID: {doc['id']}",
                        document_id=doc['id'],
                        file_info={
                            "filename": filename,
                            "file_type": file_type,
                            "file_hash": file_hash,
                            "file_size": file_path.stat().st_size
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
        if not semantic_chunker:
            raise HTTPException(status_code=500, detail="语义分割器未初始化")
        
        # 使用语义分割器分割文本
        chunks = semantic_chunker.split_text(text_content)
        logger.info(f"语义分割完成，共 {len(chunks)} 个块")
        
        if not chunks:
            raise HTTPException(status_code=400, detail="文本分割后无有效内容")
        
        # 6. 存储文档到SQLite数据库
        if not sqlite_manager:
            raise HTTPException(status_code=500, detail="数据库管理器未初始化")
        
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
        
        logger.info(f"文档存储完成，文档ID: {document_id}")
        
        # 7. 向量化并存储到Faiss数据库
        if not faiss_manager:
            raise HTTPException(status_code=500, detail="向量数据库管理器未初始化")
        
        embedding_service = get_embedding_service()
        
        # 处理每个文本块
        for i, chunk in enumerate(chunks):
            try:
                # 向量化文本块
                embedding = embedding_service.encode_text(chunk)
                
                # 存储到Faiss
                vector_id = faiss_manager.add_vector(
                    embedding, 
                    {
                        "document_id": document_id,
                        "chunk_index": i,
                        "chunk_text": chunk[:200] + "..." if len(chunk) > 200 else chunk,
                        "file_type": file_type,
                        "filename": filename
                    }
                )
                
                # 存储文档块到SQLite
                sqlite_manager.insert_chunk(
                    document_id=document_id,
                    chunk_index=i,
                    content=chunk,
                    vector_id=vector_id,
                    metadata={
                        "chunk_length": len(chunk),
                        "vector_dimension": len(embedding)
                    }
                )
                
            except Exception as e:
                logger.error(f"处理文本块 {i} 时出错: {str(e)}")
                # 继续处理其他块，不中断整个流程
        
        logger.info(f"向量化和存储完成，文档ID: {document_id}")
        
        return FileUploadResponse(
            status="success",
            message=f"文件上传成功，共处理 {len(chunks)} 个文本块",
            document_id=document_id,
            chunks_count=len(chunks),
            file_info={
                "filename": filename,
                "file_type": file_type,
                "file_hash": file_hash,
                "file_size": file_path.stat().st_size,
                "text_length": len(text_content)
            }
        )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"文件上传处理失败: {str(e)}")
        raise HTTPException(status_code=500, detail=f"文件上传处理失败: {str(e)}")

def calculate_file_hash(file_path: pathlib.Path) -> str:
    """计算文件的MD5哈希值"""
    hash_md5 = hashlib.md5()
    with open(file_path, "rb") as f:
        for chunk in iter(lambda: f.read(4096), b""):
            hash_md5.update(chunk)
    return hash_md5.hexdigest()