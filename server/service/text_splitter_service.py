"""
文本分割服务 - 支持多种分割方法的可切换接口
"""
import logging
from typing import List, Optional
from pathlib import Path
from langchain.text_splitter import RecursiveCharacterTextSplitter
from langchain_experimental.text_splitter import SemanticChunker
from .langchain_embedding_service import BGEM3LangChainWrapper

logger = logging.getLogger(__name__)

class TextSplitterService:
    """文本分割服务类"""
    
    def __init__(self, splitter_type: str = "recursive", **kwargs):
        """
        初始化文本分割服务
        
        Args:
            splitter_type: 分割器类型 "recursive" 或 "semantic"
            **kwargs: 其他配置参数
        """
        self.splitter_type = splitter_type
        self.splitter = None
        self._init_splitter(**kwargs)
    
    def _init_splitter(self, **kwargs):
        """初始化分割器"""
        if self.splitter_type == "recursive":
            self._init_recursive_splitter(**kwargs)
        elif self.splitter_type == "semantic":
            self._init_semantic_splitter(**kwargs)
        else:
            raise ValueError(f"不支持的分割器类型: {self.splitter_type}")
    
    def _init_recursive_splitter(self, **kwargs):
        """初始化递归字符分割器"""
        # 默认参数
        chunk_size = kwargs.get('chunk_size', 300)
        chunk_overlap = kwargs.get('chunk_overlap', 80)
        separators = kwargs.get('separators', ["\n\n", "\n", " ", ""])
        
        self.splitter = RecursiveCharacterTextSplitter(
            chunk_size=chunk_size,
            chunk_overlap=chunk_overlap,
            separators=separators,
            length_function=len,
        )
        
        logger.info(f"初始化递归字符分割器: chunk_size={chunk_size}, chunk_overlap={chunk_overlap}")
    
    def _init_semantic_splitter(self, **kwargs):
        """初始化语义分割器"""
        try:
            # 获取项目根目录
            project_root = Path(__file__).parent.parent.parent
            bge_m3_model_path = project_root / "meta" / "embedding" / "bge-m3"
            
            # 初始化嵌入模型
            embedding_model = BGEM3LangChainWrapper(bge_m3_model_path, use_fp16=True)
            
            # 默认参数
            breakpoint_threshold_type = kwargs.get('breakpoint_threshold_type', 'percentile')
            breakpoint_threshold_amount = kwargs.get('breakpoint_threshold_amount', 90.0)
            
            self.splitter = SemanticChunker(
                embedding_model,
                breakpoint_threshold_type=breakpoint_threshold_type,
                breakpoint_threshold_amount=breakpoint_threshold_amount
            )
            
            logger.info(f"初始化语义分割器: breakpoint_threshold_type={breakpoint_threshold_type}, "
                       f"breakpoint_threshold_amount={breakpoint_threshold_amount}")
            
        except Exception as e:
            logger.error(f"初始化语义分割器失败: {str(e)}")
            # 回退到递归分割器
            logger.info("回退到递归字符分割器")
            self._init_recursive_splitter(**kwargs)
    
    def split_text(self, text: str) -> List[str]:
        """
        分割文本
        
        Args:
            text: 要分割的文本
            
        Returns:
            分割后的文本块列表
        """
        if not text or not text.strip():
            return []
        
        if self.splitter is None:
            raise RuntimeError("分割器未初始化")
        
        try:
            if self.splitter_type == "recursive":
                chunks = self.splitter.split_text(text)
            else:  # semantic
                # SemanticChunker返回的是Document对象列表
                documents = self.splitter.create_documents([text])
                chunks = [doc.page_content for doc in documents]
            
            logger.info(f"文本分割完成: 原始长度={len(text)}, 分割块数={len(chunks)}")
            return chunks
            
        except Exception as e:
            logger.error(f"文本分割失败: {str(e)}")
            # 如果分割失败，返回原始文本作为单个块
            return [text] if text.strip() else []
    
    def get_splitter_info(self) -> dict:
        """获取分割器信息"""
        return {
            "type": self.splitter_type,
            "splitter_class": self.splitter.__class__.__name__ if self.splitter else None
        }

# 全局服务实例
_text_splitter_service: Optional[TextSplitterService] = None

def init_text_splitter_service(splitter_type: str = "recursive", **kwargs):
    """
    初始化全局文本分割服务
    
    Args:
        splitter_type: 分割器类型
        **kwargs: 其他配置参数
    """
    global _text_splitter_service
    _text_splitter_service = TextSplitterService(splitter_type, **kwargs)
    logger.info(f"文本分割服务初始化完成，类型: {splitter_type}")

def get_text_splitter_service() -> TextSplitterService:
    """
    获取文本分割服务实例
    
    Returns:
        TextSplitterService实例
    """
    global _text_splitter_service
    if _text_splitter_service is None:
        # 默认使用递归分割器
        init_text_splitter_service("recursive")
    return _text_splitter_service

def split_text(text: str) -> List[str]:
    """
    便捷的文本分割函数
    
    Args:
        text: 要分割的文本
        
    Returns:
        分割后的文本块列表
    """
    service = get_text_splitter_service()
    return service.split_text(text)