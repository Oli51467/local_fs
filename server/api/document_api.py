from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional, List, Callable, Awaitable
import logging
import hashlib
import pathlib
import re
import asyncio
from datetime import datetime
from typing import Dict, Any
from service.embedding_service import get_embedding_service
from service.faiss_service import FaissManager
from service.sqlite_service import SQLiteManager
from service.text_splitter_service import init_text_splitter_service, get_text_splitter_service
from config.config import ServerConfig, DatabaseConfig
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

class UnmountDocumentRequest(BaseModel):
    """取消挂载文档请求模型"""
    file_path: str
    is_folder: bool = False

class UnmountDocumentResponse(BaseModel):
    """取消挂载文档响应模型"""
    status: str
    message: str
    unmounted_documents: int
    unmounted_vectors: int

class DeleteDocumentResponse(BaseModel):
    """删除文档响应模型"""
    status: str
    message: str
    deleted_documents: int
    deleted_vectors: int

class ReuploadDocumentRequest(BaseModel):
    """重新上传文档请求模型"""
    file_path: str
    force_reupload: bool = False  # 是否强制重新上传，忽略哈希检查

class ReuploadDocumentResponse(BaseModel):
    """重新上传文档响应模型"""
    status: str
    message: str
    document_id: Optional[int] = None
    file_info: Optional[Dict[str, Any]] = None


class FolderUploadStatusRequest(BaseModel):
    """文件夹上传状态请求模型"""
    folder_path: str


class FolderUploadStatusResponse(BaseModel):
    """文件夹上传状态响应模型"""
    folder: str
    files: Dict[str, bool]
    uploaded_files: List[str]


class FolderOperationRequest(BaseModel):
    """文件夹挂载/取消挂载请求"""
    folder_path: str


class FolderRemountRequest(BaseModel):
    """文件夹重新挂载请求"""
    folder_path: str
    force_reupload: bool = True

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/document", tags=["document"])

# 全局变量
faiss_manager = None
sqlite_manager = None
text_splitter_service = None


def read_text_file_with_fallback(file_path: pathlib.Path) -> str:
    encodings = ['utf-8', 'utf-8-sig', 'gbk']
    for encoding in encodings:
        try:
            with open(file_path, 'r', encoding=encoding) as f:
                return f.read()
        except UnicodeDecodeError:
            continue

    with open(file_path, 'r', encoding='utf-8', errors='ignore') as f:
        return f.read()


def markdown_to_plain_text(markdown_text: str) -> str:
    text = markdown_text
    text = re.sub(r'^---[\s\S]*?---\s*', '', text, flags=re.MULTILINE)  # front matter
    text = re.sub(r'```[\s\S]*?```', '\n', text)
    text = re.sub(r'`([^`]+)`', r'\1', text)
    text = re.sub(r'!\[([^\]]*)\]\([^\)]+\)', r'\1', text)
    text = re.sub(r'\[([^\]]+)\]\([^\)]+\)', r'\1', text)
    text = re.sub(r'^#{1,6}\s*', '', text, flags=re.MULTILINE)
    text = re.sub(r'>\s?', '', text)
    text = re.sub(r'\*\*([^*]+)\*\*', r'\1', text)
    text = re.sub(r'__([^_]+)__', r'\1', text)
    text = re.sub(r'\*([^*]+)\*', r'\1', text)
    text = re.sub(r'_([^_]+)_', r'\1', text)
    text = re.sub(r'~~([^~]+)~~', r'\1', text)
    text = re.sub(r'(?m)^\s*[-*+]\s+', '', text)
    text = re.sub(r'(?m)^\s*\d+\.\s+', '', text)
    text = re.sub(r'\s+\n', '\n', text)
    text = text.replace('\r\n', '\n').replace('\r', '\n')
    text = re.sub(r'\n{3,}', '\n\n', text)
    return text.strip()


def extract_text_content(file_path: pathlib.Path, file_type: str) -> str:
    raw_text = read_text_file_with_fallback(file_path)
    lowered = file_type.lower()
    if lowered in {'md', 'markdown'}:
        return markdown_to_plain_text(raw_text)
    return raw_text


def resolve_folder_path(folder_path: str) -> pathlib.Path:
    path_obj = pathlib.Path(folder_path)
    if not path_obj.is_absolute():
        path_obj = (ServerConfig.PROJECT_ROOT / path_obj).resolve()
    else:
        path_obj = path_obj.resolve()

    try:
        path_obj.relative_to(ServerConfig.PROJECT_ROOT)
    except ValueError:
        raise HTTPException(status_code=400, detail="文件夹必须位于项目根目录内")

    if not path_obj.exists() or not path_obj.is_dir():
        raise HTTPException(status_code=404, detail=f"文件夹不存在: {path_obj}")

    return path_obj


def collect_files_in_folder(folder_path: pathlib.Path) -> List[pathlib.Path]:
    files = []
    for child in folder_path.rglob('*'):
        if child.is_file() and not child.name.startswith('.'):
            files.append(child)
    return files


async def run_folder_tasks(
    files: List[pathlib.Path],
    operation: Callable[[pathlib.Path], Awaitable[Any]],
    max_concurrency: int = 8
) -> List[Dict[str, Any]]:
    semaphore = asyncio.Semaphore(max(1, min(max_concurrency, len(files))))
    results: List[Dict[str, Any]] = []

    async def worker(path: pathlib.Path) -> Dict[str, Any]:
        async with semaphore:
            try:
                outcome = await operation(path)
                status = getattr(outcome, 'status', None)
                success = status not in {'error', 'failed'}
                return {
                    'path': str(path),
                    'status': status or 'success',
                    'detail': outcome.dict() if hasattr(outcome, 'dict') else outcome,
                    'success': success
                }
            except HTTPException as http_exc:
                logger.error("处理文件失败 (HTTP): %s - %s", path, http_exc.detail)
                return {
                    'path': str(path),
                    'status': 'error',
                    'detail': http_exc.detail,
                    'success': False
                }
            except Exception as exc:  # pylint: disable=broad-except
                logger.error("处理文件失败: %s - %s", path, exc)
                return {
                    'path': str(path),
                    'status': 'error',
                    'detail': str(exc),
                    'success': False
                }

    tasks = [worker(path) for path in files]
    results = await asyncio.gather(*tasks)
    return results

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


@router.post("/upload-status", response_model=FolderUploadStatusResponse)
async def get_folder_upload_status(request: FolderUploadStatusRequest):
    """查询指定文件夹下一层文件的上传状态"""
    if sqlite_manager is None:
        raise HTTPException(status_code=500, detail="数据库管理器未初始化")

    raw_path = request.folder_path.strip()
    if not raw_path or raw_path in {".", "./", ""}:
        normalized_path = "data"
    else:
        trimmed = raw_path.strip()
        trimmed = trimmed.lstrip("/")
        trimmed = trimmed.lstrip("./")
        if not trimmed:
            normalized_path = "data"
        elif trimmed.startswith("data"):
            normalized_path = trimmed.rstrip("/") or "data"
        else:
            normalized_path = f"data/{trimmed.rstrip('/')}"

    project_root = ServerConfig.PROJECT_ROOT.resolve()
    data_root = DatabaseConfig.DATABASE_DIR.resolve()

    folder_relative = pathlib.Path(normalized_path)
    folder_full_path = (project_root / folder_relative).resolve()

    try:
        folder_full_path.relative_to(data_root)
    except ValueError:
        raise HTTPException(status_code=400, detail="文件夹必须位于数据目录内")

    if not folder_full_path.exists() or not folder_full_path.is_dir():
        raise HTTPException(status_code=404, detail="指定的文件夹不存在")

    try:
        entries = [entry for entry in folder_full_path.iterdir() if entry.is_file()]
    except PermissionError as exc:
        logger.error("读取文件夹失败: %s", exc)
        raise HTTPException(status_code=500, detail="读取文件夹内容失败") from exc

    entries.sort(key=lambda path: path.name.lower())

    path_pairs = []
    for file_path in entries:
        try:
            rel_path = str(file_path.resolve().relative_to(project_root))
        except ValueError:
            logger.warning("文件 %s 不在项目根目录内，已跳过", file_path)
            rel_path = None
        path_pairs.append((file_path, rel_path))

    valid_rel_paths = [rel_path for _, rel_path in path_pairs if rel_path is not None]
    existing_paths = set(sqlite_manager.get_documents_by_paths(valid_rel_paths))

    files_status: Dict[str, bool] = {}
    for file_path, rel_path in path_pairs:
        files_status[file_path.name] = rel_path in existing_paths if rel_path else False

    uploaded_files = [name for name, uploaded in files_status.items() if uploaded]

    return FolderUploadStatusResponse(
        folder=str(folder_relative),
        files=files_status,
        uploaded_files=uploaded_files
    )

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
        
        # 4. 根据文档类型提取文本
        supported_types = {"txt", "md", "markdown"}
        if file_type not in supported_types:
            raise HTTPException(status_code=400, detail=f"暂不支持的文件类型: {file_type}")

        text_content = extract_text_content(file_path, file_type)

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


@router.post("/mount-folder")
async def mount_folder(request: FolderOperationRequest) -> Dict[str, Any]:
    """批量挂载文件夹中的所有文件"""
    folder_path = resolve_folder_path(request.folder_path)
    files = collect_files_in_folder(folder_path)

    if not files:
        raise HTTPException(status_code=400, detail="文件夹内没有可挂载的文件")

    if len(files) > 50:
        raise HTTPException(status_code=400, detail="单次挂载的文件数量超过 50 个，请拆分后重试")

    logger.info("开始批量挂载文件夹: %s, 文件数量: %d", folder_path, len(files))

    async def mount_file(path: pathlib.Path):
        upload_request = FileUploadRequest(file_path=str(path))
        return await upload_document(upload_request)

    results = await run_folder_tasks(files, mount_file)

    success_count = sum(1 for item in results if item['success'])
    failure_count = len(results) - success_count

    status = 'success' if failure_count == 0 else ('partial' if success_count > 0 else 'failed')

    return {
        'status': status,
        'folder': str(folder_path),
        'total_files': len(results),
        'succeeded': success_count,
        'failed': failure_count,
        'details': results
    }


@router.post("/remount-folder")
async def remount_folder(request: FolderRemountRequest) -> Dict[str, Any]:
    """批量重新挂载文件夹中的所有文件"""
    folder_path = resolve_folder_path(request.folder_path)
    files = collect_files_in_folder(folder_path)

    if not files:
        raise HTTPException(status_code=400, detail="文件夹内没有可重新挂载的文件")

    if len(files) > 50:
        raise HTTPException(status_code=400, detail="单次重新挂载的文件数量超过 50 个，请拆分后重试")

    logger.info("开始批量重新挂载文件夹: %s, 文件数量: %d", folder_path, len(files))

    force = request.force_reupload

    async def remount_file(path: pathlib.Path):
        reupload_request = ReuploadDocumentRequest(file_path=str(path), force_reupload=force)
        return await reupload_document(reupload_request)

    results = await run_folder_tasks(files, remount_file)

    success_count = sum(1 for item in results if item['success'])
    failure_count = len(results) - success_count
    status = 'success' if failure_count == 0 else ('partial' if success_count > 0 else 'failed')

    return {
        'status': status,
        'folder': str(folder_path),
        'total_files': len(results),
        'succeeded': success_count,
        'failed': failure_count,
        'details': results
    }


@router.post("/unmount-folder")
async def unmount_folder(request: FolderOperationRequest) -> Dict[str, Any]:
    """批量取消挂载文件夹中的所有文件"""
    folder_path = resolve_folder_path(request.folder_path)
    files = collect_files_in_folder(folder_path)

    if not files:
        raise HTTPException(status_code=400, detail="文件夹内没有可取消挂载的文件")

    if len(files) > 50:
        raise HTTPException(status_code=400, detail="单次取消挂载的文件数量超过 50 个，请拆分后重试")

    logger.info("开始批量取消挂载文件夹: %s, 文件数量: %d", folder_path, len(files))

    async def unmount_file(path: pathlib.Path):
        unmount_request = UnmountDocumentRequest(file_path=str(path), is_folder=False)
        return await unmount_document(unmount_request)

    results = await run_folder_tasks(files, unmount_file)

    success_count = sum(1 for item in results if item['success'])
    failure_count = len(results) - success_count
    status = 'success' if failure_count == 0 else ('partial' if success_count > 0 else 'failed')

    return {
        'status': status,
        'folder': str(folder_path),
        'total_files': len(results),
        'succeeded': success_count,
        'failed': failure_count,
        'details': results
    }
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

        updated_vectors = 0
        if faiss_manager is None:
            logger.warning('Faiss 管理器未初始化，无法同步更新向量路径')
        else:
            try:
                if request.is_folder:
                    updated_vectors = faiss_manager.update_metadata_by_path_prefix(old_path, new_path)
                    logger.info(
                        "Faiss 元数据路径更新（文件夹）: %s -> %s，更新了 %d 条记录",
                        old_path,
                        new_path,
                        updated_vectors
                    )
                else:
                    updated_vectors = faiss_manager.update_metadata_by_path(old_path, new_path)
                    logger.info(
                        "Faiss 元数据路径更新（文件）: %s -> %s，更新了 %d 条记录",
                        old_path,
                        new_path,
                        updated_vectors
                    )
            except Exception as faiss_error:
                logger.error(
                    "更新 Faiss 元数据路径失败: %s -> %s，错误: %s",
                    old_path,
                    new_path,
                    faiss_error
                )

        if updated_count > 0 or updated_vectors > 0:
            return {
                "status": "success",
                "message": f"成功更新文档 {updated_count} 个、向量 {updated_vectors} 个路径",
                "updated_documents": updated_count,
                "updated_vectors": updated_vectors
            }
        else:
            return {
                "status": "not_found",
                "message": "未找到需要更新路径的文档或向量",
                "updated_documents": 0,
                "updated_vectors": 0
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

@router.post("/unmount", response_model=UnmountDocumentResponse)
async def unmount_document(request: UnmountDocumentRequest):
    """
    取消挂载文档 - 删除数据库中的记录但不删除文件
    
    Args:
        request: 取消挂载请求，包含文件路径和是否为文件夹
        
    Returns:
        取消挂载结果，包括取消挂载的文档数量和向量数量
    """
    try:
        logger.info(f"收到文档取消挂载请求: {request.file_path}, 文件夹: {request.is_folder}")
        
        if not sqlite_manager or not faiss_manager:
            raise HTTPException(status_code=500, detail="数据库管理器未初始化")
        
        # 验证路径参数
        if not request.file_path:
            raise HTTPException(status_code=400, detail="文件路径不能为空")
        
        # 标准化路径（移除前导斜杠）
        file_path = request.file_path.lstrip('/')
        
        unmounted_docs = 0
        unmounted_vectors = 0
        
        if request.is_folder:
            # 取消挂载文件夹及其下所有文档
            logger.info(f"开始递归取消挂载文件夹: {file_path}")
            
            # 1. 获取文件夹下所有文档的向量ID
            vector_ids = sqlite_manager.get_vector_ids_by_path_prefix(file_path)
            logger.info(f"找到 {len(vector_ids)} 个向量需要取消挂载")
            
            # 2. 从SQLite中删除文档及相关数据（但不删除文件）
            unmounted_docs = sqlite_manager.delete_documents_by_path_prefix(file_path)
            logger.info(f"从SQLite中取消挂载了 {unmounted_docs} 个文档")
            
            # 3. 从Faiss中删除向量
            if vector_ids:
                unmounted_vectors = faiss_manager.delete_vectors_by_ids(vector_ids)
                logger.info(f"从Faiss中删除了 {unmounted_vectors} 个向量")
            
        else:
            # 取消挂载单个文档
            logger.info(f"开始取消挂载单个文档: {file_path}")
            
            # 1. 获取文档的向量ID
            vector_ids = sqlite_manager.get_vector_ids_by_path(file_path)
            logger.info(f"找到 {len(vector_ids)} 个向量需要取消挂载")
            
            # 2. 从SQLite中删除文档及相关数据（但不删除文件）
            unmounted_docs = sqlite_manager.delete_document_by_path(file_path)
            logger.info(f"从SQLite中取消挂载了 {unmounted_docs} 个文档")
            
            # 3. 从Faiss中删除向量
            if vector_ids:
                unmounted_vectors = faiss_manager.delete_vectors_by_ids(vector_ids)
                logger.info(f"从Faiss中删除了 {unmounted_vectors} 个向量")
        
        return UnmountDocumentResponse(
            status="success",
            message=f"成功取消挂载了 {unmounted_docs} 个文档和 {unmounted_vectors} 个向量",
            unmounted_documents=unmounted_docs,
            unmounted_vectors=unmounted_vectors
        )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"取消挂载文档失败: {str(e)}")
        raise HTTPException(status_code=500, detail=f"取消挂载文档失败: {str(e)}")

@router.post("/reupload", response_model=ReuploadDocumentResponse)
async def reupload_document(request: ReuploadDocumentRequest):
    """
    重新上传文档到系统
    
    Args:
        request: 重新上传请求，包含文件路径和是否强制重新上传
        
    Returns:
        重新上传结果，包括状态、消息和文档信息
    """
    try:
        logger.info(f"收到文件重新上传请求: {request.file_path}, 强制重新上传: {request.force_reupload}")
        
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
        relative_file_path = str(file_path.relative_to(project_root))
        logger.info(f"文件信息: 名称={filename}, 类型={file_type}, 相对路径={relative_file_path}")
        
        # 3. 计算文件哈希值
        file_hash = calculate_file_hash(file_path)
        file_size = file_path.stat().st_size
        
        # 4. 检查文档是否已存在
        if not sqlite_manager:
            raise HTTPException(status_code=500, detail="数据库管理器未初始化")
        
        existing_doc = sqlite_manager.get_document_by_path(relative_file_path)
        
        if not existing_doc:
            # 文档不存在，直接上传
            logger.info(f"文档不存在，直接上传: {relative_file_path}")
            # 调用现有的上传逻辑
            upload_request = FileUploadRequest(file_path=request.file_path)
            upload_response = await upload_document(upload_request)
            
            return ReuploadDocumentResponse(
                status="uploaded",
                message="文档上传成功",
                document_id=upload_response.document_id,
                file_info=upload_response.file_info
            )
        
        # 文档已存在，检查是否需要重新上传
        existing_hash = existing_doc.get('file_hash')
        existing_document_id = existing_doc.get('id')
        
        # 如果哈希相同且没有强制重新上传，则不需要重新处理
        if existing_hash == file_hash and not request.force_reupload:
            logger.info(f"文件哈希相同，无需重新上传: {file_hash}")
            return ReuploadDocumentResponse(
                status="unchanged",
                message="文件内容未改变，无需重新上传",
                document_id=existing_document_id,
                file_info={
                    "filename": filename,
                    "file_type": file_type,
                    "file_hash": file_hash,
                    "file_size": file_size,
                    "existing_path": relative_file_path
                }
            )
        
        # 哈希不同或强制重新上传，删除旧数据并重新处理
        logger.info(f"文件哈希不同或强制重新上传，旧哈希: {existing_hash}, 新哈希: {file_hash}")
        
        # 5. 删除旧文档数据（包括文档、chunks和sqlite_sequence）
        logger.info(f"开始删除旧文档数据，文档ID: {existing_document_id}, 文件路径: {relative_file_path}")
        
        # 获取旧向量的ID（用于后续从Faiss删除）
        old_vector_ids = sqlite_manager.get_vector_ids_by_path(relative_file_path)
        logger.info(f"找到 {len(old_vector_ids)} 个旧向量需要删除")
        
        # 从SQLite中删除文档及相关数据（包括documents、document_chunks和sqlite_sequence）
        deleted_docs = sqlite_manager.delete_document_by_path(relative_file_path)
        if deleted_docs > 0:
            logger.info(f"成功从SQLite中删除文档及相关数据，删除了 {deleted_docs} 个文档记录")
            logger.info(f"同时删除了该文档的所有chunks数据，并重置了sqlite_sequence表")
        else:
            logger.warning(f"删除文档数据失败或文档不存在: {relative_file_path}")
        
        # 从Faiss中删除对应的向量
        deleted_vectors = 0
        if old_vector_ids and faiss_manager:
            deleted_vectors = faiss_manager.delete_vectors_by_ids(old_vector_ids)
            logger.info(f"从Faiss中删除了 {deleted_vectors} 个向量")
        
        # 6. 重新上传文档（调用现有的上传逻辑）
        logger.info("开始重新上传文档")
        upload_request = FileUploadRequest(file_path=request.file_path)
        upload_response = await upload_document(upload_request)
        
        return ReuploadDocumentResponse(
            status="reuploaded",
            message="文档重新上传成功",
            document_id=upload_response.document_id,
            file_info=upload_response.file_info
        )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"文档重新上传失败: {str(e)}")
        raise HTTPException(status_code=500, detail=f"文档重新上传失败: {str(e)}")

def calculate_file_hash(file_path: pathlib.Path) -> str:
    """计算文件哈希值"""
    hash_sha256 = hashlib.sha256()
    with open(file_path, "rb") as f:
        for chunk in iter(lambda: f.read(4096), b""):
            hash_sha256.update(chunk)
    return hash_sha256.hexdigest()
