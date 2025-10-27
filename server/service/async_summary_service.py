import asyncio
import logging
import uuid
from datetime import datetime
from typing import Any, Dict, Optional, List
from enum import Enum
from dataclasses import dataclass, asdict

import requests
from requests.exceptions import RequestException, Timeout
from openai import OpenAI

from service.sqlite_service import SQLiteManager
from service.llm_client import SiliconFlowClient, LLMClientError
from service.text_utils import prepare_summary_preview, strip_think_tags

logger = logging.getLogger(__name__)


class TaskStatus(Enum):
    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"


@dataclass
class SummaryTask:
    task_id: str
    conversation_id: int
    status: TaskStatus
    created_at: datetime
    updated_at: datetime
    result: Optional[Dict[str, Any]] = None
    error: Optional[str] = None
    progress: int = 0  # 0-100


class AsyncSummaryService:
    def __init__(self, sqlite_manager: SQLiteManager, llm_client: Optional[SiliconFlowClient] = None):
        self.sqlite_manager = sqlite_manager
        self.llm_client = llm_client
        self.tasks: Dict[str, SummaryTask] = {}
        self._running_tasks: Dict[str, asyncio.Task] = {}
        # Provider base URLs (align with chat_api)
        self.MODELSCOPE_BASE_URL = "https://api-inference.modelscope.cn/v1/"
        self.DASHSCOPE_BASE_URL = "https://dashscope.aliyuncs.com/compatible-mode/v1"
        self.OLLAMA_REQUEST_TIMEOUT = 60
        
    def create_summary_task(self, conversation_id: int) -> str:
        """创建一个新的总结任务并返回任务ID"""
        task_id = str(uuid.uuid4())
        now = datetime.utcnow()
        
        task = SummaryTask(
            task_id=task_id,
            conversation_id=conversation_id,
            status=TaskStatus.PENDING,
            created_at=now,
            updated_at=now
        )
        
        self.tasks[task_id] = task
        logger.info(f"Created summary task {task_id} for conversation {conversation_id}")
        return task_id
    
    def get_task_status(self, task_id: str) -> Optional[Dict[str, Any]]:
        """获取任务状态"""
        task = self.tasks.get(task_id)
        if not task:
            return None
            
        return {
            "task_id": task.task_id,
            "conversation_id": task.conversation_id,
            "status": task.status.value,
            "created_at": task.created_at.isoformat(),
            "updated_at": task.updated_at.isoformat(),
            "progress": task.progress,
            "result": task.result,
            "error": task.error
        }
    
    async def start_summary_task(
        self,
        task_id: str,
        model_selection: Dict[str, Any],
        max_history: int = 20,
        extra_body: Optional[Dict[str, Any]] = None
    ) -> None:
        """启动异步总结任务"""
        task = self.tasks.get(task_id)
        if not task:
            logger.error(f"Task {task_id} not found")
            return
            
        if task.status != TaskStatus.PENDING:
            logger.warning(f"Task {task_id} is not in pending status: {task.status}")
            return
            
        # 创建异步任务
        async_task = asyncio.create_task(
            self._execute_summary_task(task_id, model_selection, max_history, extra_body)
        )
        self._running_tasks[task_id] = async_task
        
        # 更新任务状态
        task.status = TaskStatus.RUNNING
        task.updated_at = datetime.utcnow()
        task.progress = 10
        
        logger.info(f"Started summary task {task_id}")
    
    async def _execute_summary_task(
        self,
        task_id: str,
        model_selection: Dict[str, Any],
        max_history: int,
        extra_body: Optional[Dict[str, Any]]
    ) -> None:
        """执行总结任务的核心逻辑"""
        task = self.tasks.get(task_id)
        if not task:
            return
            
        try:
            # 更新进度：开始处理
            task.progress = 20
            task.updated_at = datetime.utcnow()
            
            # 获取对话消息
            records = self.sqlite_manager.get_conversation_messages(task.conversation_id)
            if not records:
                raise ValueError("该会话暂无消息，无法生成摘要")
            
            # 更新进度：构建提示
            task.progress = 40
            task.updated_at = datetime.utcnow()
            
            # 构建总结提示
            summary_messages = self._build_summary_prompt(records, max_history)
            
            # 更新进度：调用模型
            task.progress = 60
            task.updated_at = datetime.utcnow()
            
            # 调用LLM生成总结
            payload = self._build_llm_payload(model_selection, summary_messages, extra_body)
            result = await self._invoke_llm_async(model_selection, payload)
            
            # 更新进度：处理结果
            task.progress = 80
            task.updated_at = datetime.utcnow()
            
            # 解析结果
            content = self._extract_completion_content(result)
            parsed = self._parse_summary_response(content)
            
            summary_text = (parsed.get("summary") or "").strip()
            title_text = (parsed.get("title") or "").strip()
            summary_text, _ = strip_think_tags(summary_text)
            title_text, _ = strip_think_tags(title_text)
            
            # 生成默认标题和摘要
            if not title_text:
                first_user = next((msg for msg in records if msg.get("role") == "user"), None)
                fallback_source = first_user["content"] if first_user else summary_text
                title_text = self._generate_conversation_title(fallback_source or "新对话")
            if not summary_text:
                fallback_summary, _ = strip_think_tags(content)
                summary_text = fallback_summary.strip() or title_text
            
            # 更新数据库
            summary_preview = prepare_summary_preview(summary_text, limit=20)
            self.sqlite_manager.update_conversation_summary(task.conversation_id, summary_text)
            self.sqlite_manager.update_conversation_title(task.conversation_id, title_text)
            
            # 获取更新后的对话信息
            conversation = self.sqlite_manager.get_conversation_by_id(task.conversation_id) or {
                "id": task.conversation_id,
                "title": title_text,
                "summary": summary_text,
                "created_time": datetime.utcnow().isoformat(),
                "updated_time": datetime.utcnow().isoformat(),
            }
            
            last_message = records[-1] if records else None
            
            # 构建结果
            result_data = {
                "id": int(task.conversation_id),
                "title": conversation["title"],
                "summary": summary_preview,
                "created_time": conversation["created_time"],
                "updated_time": conversation["updated_time"],
                "last_message": last_message.get("content") if last_message else None,
                "last_role": last_message.get("role") if last_message else None,
                "message_count": len(records),
            }
            
            # 更新任务状态为完成
            task.status = TaskStatus.COMPLETED
            task.progress = 100
            task.result = result_data
            task.updated_at = datetime.utcnow()
            
            logger.info(f"Summary task {task_id} completed successfully")
            
        except Exception as e:
            logger.error(f"Summary task {task_id} failed: {str(e)}")
            task.status = TaskStatus.FAILED
            task.error = str(e)
            task.updated_at = datetime.utcnow()
        finally:
            # 清理运行中的任务
            if task_id in self._running_tasks:
                del self._running_tasks[task_id]
    
    def _build_summary_prompt(self, messages: List[Dict[str, Any]], limit: int) -> List[Dict[str, Any]]:
        """构建总结提示"""
        filtered = [msg for msg in messages if msg.get("role") in {"user", "assistant"}]
        trimmed = filtered[-limit:] if limit and len(filtered) > limit else filtered
        transcript_lines: List[str] = []
        for record in trimmed:
            content = (record.get("content") or "").strip()
            if not content:
                continue
            role = record.get("role")
            role_label = "助手" if role == "assistant" else "用户"
            transcript_lines.append(f"{role_label}：{content}")
        transcript = "\n".join(transcript_lines).strip() or "（暂无有效对话内容）"
        system_prompt = (
            "你是总结助手，请阅读对话并仅输出 JSON，对象格式："
            '{"title": "...", "summary": "..."}。'
            "title 需要不超过 16 个汉字或 30 个字符，总结对话主题，不要使用标点。"
            "summary 需要 80-150 字，概括用户诉求、助手回应与下一步计划。"
            "严禁输出 JSON 以外的内容。"
        )
        user_prompt = f"以下是对话：\n\n{transcript}\n\n请生成标题和摘要。"
        return [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ]
    
    def _build_llm_payload(
        self,
        selection: Dict[str, Any],
        messages: List[Dict[str, Any]],
        extra_body: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        """构建LLM请求载荷"""
        payload = {
            "model": selection.get("api_model"),
            "messages": messages,
            "temperature": 0.2,
            "top_p": 0.9,
            "stream": False,
            "max_tokens": 4096
        }
        # Provider-specific extras (keep consistent with chat_api)
        merged_extra: Dict[str, Any] = dict(extra_body or {})
        source_id = (selection.get("source_id") or "").strip()
        if source_id == "modelscope":
            merged_extra.setdefault("enable_thinking", False)
            merged_extra.setdefault("thinking_budget", 40960)
        elif source_id == "dashscope":
            merged_extra.setdefault("enable_thinking", True)
            merged_extra.setdefault("thinking_budget", 40960)
        if merged_extra:
            payload["extra_body"] = merged_extra

        return payload

    async def _invoke_llm_async(self, selection: Dict[str, Any], payload: Dict[str, Any]) -> Dict[str, Any]:
        """异步调用LLM，遵循用户选择的 provider"""
        source_id = (selection.get("source_id") or "").strip()
        api_key = (selection.get("api_key") or "").strip()
        loop = asyncio.get_event_loop()

        # 兼容 Ollama 本地/自定义端点
        if source_id == "ollama":
            url = (selection.get("api_url") or "").strip()
            if not url:
                raise LLMClientError("Ollama 接口 URL 未配置")

            def call_ollama() -> Dict[str, Any]:
                req_payload = dict(payload)
                req_payload["stream"] = False
                headers = {
                    "Content-Type": "application/json",
                    "Accept": "application/json",
                }
                try:
                    response = requests.post(
                        url,
                        json=req_payload,
                        headers=headers,
                        timeout=self.OLLAMA_REQUEST_TIMEOUT,
                    )
                except (Timeout, RequestException) as exc:
                    raise LLMClientError(str(exc)) from exc

                body_text = ""
                try:
                    body_text = response.text or ""
                except Exception:
                    body_text = ""

                if response.status_code != 200:
                    error_payload: Optional[Dict[str, Any]] = None
                    try:
                        error_payload = response.json()
                    except ValueError:
                        error_payload = None
                    message = None
                    if isinstance(error_payload, dict):
                        message = error_payload.get("error") or error_payload.get("message")
                    if not message:
                        message = body_text.strip() or response.reason or "Ollama 调用失败"
                    raise LLMClientError(message, status_code=response.status_code, payload=error_payload)

                try:
                    return response.json()
                except ValueError as exc:
                    raise LLMClientError("无法解析 Ollama 返回的数据") from exc

            return await loop.run_in_executor(None, call_ollama)

        # ModelScope 兼容模式
        if source_id == "modelscope":
            if not api_key:
                raise LLMClientError("缺少模型 API Key")

            def call_modelscope() -> Dict[str, Any]:
                client = OpenAI(api_key=api_key, base_url=self.MODELSCOPE_BASE_URL)
                try:
                    response = client.chat.completions.create(**payload)
                except Exception as exc:  # pylint: disable=broad-except
                    raise LLMClientError(str(exc)) from exc
                result = response.model_dump()
                choices = result.get("choices") or []
                if choices:
                    choice = choices[0]
                    message = choice.get("message") or {}
                    main_text = self._coerce_openai_content(message.get("content")).strip()
                    reasoning_raw = (
                        message.pop("reasoning_content", None)
                        or message.pop("reasoning", None)
                        or ""
                    )
                    reasoning_text = (
                        "".join(str(item) for item in reasoning_raw)
                        if isinstance(reasoning_raw, list)
                        else str(reasoning_raw or "")
                    ).strip()
                    if reasoning_text:
                        message["content"] = f"<think>{reasoning_text}</think>{main_text}"
                    else:
                        message["content"] = main_text
                    choice["message"] = message
                    result["choices"] = [choice]
                return result

            return await loop.run_in_executor(None, call_modelscope)

        # DashScope 兼容模式
        if source_id == "dashscope":
            if not api_key:
                raise LLMClientError("缺少模型 API Key")

            def call_dashscope() -> Dict[str, Any]:
                client = OpenAI(api_key=api_key, base_url=self.DASHSCOPE_BASE_URL)
                try:
                    response = client.chat.completions.create(**payload)
                except Exception as exc:  # pylint: disable=broad-except
                    raise LLMClientError(str(exc)) from exc
                result = response.model_dump()
                choices = result.get("choices") or []
                if choices:
                    choice = choices[0]
                    message = choice.get("message") or {}
                    main_text = (message.get("content") or "").strip()
                    reasoning_raw = (
                        message.pop("reasoning_content", None)
                        or message.pop("reasoning", None)
                        or ""
                    )
                    reasoning_text = (
                        "".join(str(item) for item in reasoning_raw)
                        if isinstance(reasoning_raw, list)
                        else str(reasoning_raw or "")
                    ).strip()
                    if reasoning_text:
                        message["content"] = f"<think>{reasoning_text}</think>{main_text}"
                    else:
                        message["content"] = main_text
                    choice["message"] = message
                    result["choices"] = [choice]
                return result

            return await loop.run_in_executor(None, call_dashscope)

        # 默认走 SiliconFlow 客户端
        if not self.llm_client:
            raise LLMClientError("LLM client not initialized")
        if not api_key:
            raise LLMClientError("缺少模型 API Key")

        return await loop.run_in_executor(
            None,
            self.llm_client.chat_completion,
            api_key,
            payload,
        )
    
    def _extract_completion_content(self, result: Dict[str, Any]) -> str:
        """提取完成内容"""
        choices = result.get("choices") or []
        if not choices:
            return ""
        message = choices[0].get("message") or {}
        content = message.get("content") or ""
        return content

    def _coerce_openai_content(self, content: Any) -> str:
        """尽可能从 OpenAI 兼容响应的 content 中提取字符串"""
        if content is None:
            return ""
        if isinstance(content, list):
            return "".join(str(item) for item in content)
        if isinstance(content, dict):
            # 尝试常见结构
            text = content.get("text")
            if text is not None:
                return str(text)
            return str(content)
        return str(content)
    
    def _parse_summary_response(self, content: str) -> Dict[str, str]:
        """解析总结响应"""
        import json
        import re
        
        content = content.strip()
        if not content:
            return {}
        
        # 尝试直接解析JSON
        try:
            return json.loads(content)
        except json.JSONDecodeError:
            pass
        
        # 尝试提取JSON块
        json_match = re.search(r'\{[^{}]*"title"[^{}]*"summary"[^{}]*\}', content, re.DOTALL)
        if json_match:
            try:
                return json.loads(json_match.group())
            except json.JSONDecodeError:
                pass
        
        # 尝试提取title和summary字段
        title_match = re.search(r'"title"\s*:\s*"([^"]*)"', content)
        summary_match = re.search(r'"summary"\s*:\s*"([^"]*)"', content)
        
        return {
            "title": title_match.group(1) if title_match else "",
            "summary": summary_match.group(1) if summary_match else ""
        }
    
    def _generate_conversation_title(self, question: str) -> str:
        """生成对话标题"""
        normalized = " ".join(question.strip().split())
        if not normalized:
            return "新对话"
        if len(normalized) > 60:
            return normalized[:57] + "..."
        return normalized
    
    def cleanup_completed_tasks(self, max_age_hours: int = 24) -> None:
        """清理已完成的旧任务"""
        cutoff_time = datetime.utcnow().timestamp() - (max_age_hours * 3600)
        tasks_to_remove = []
        
        for task_id, task in self.tasks.items():
            if (task.status in [TaskStatus.COMPLETED, TaskStatus.FAILED] and 
                task.updated_at.timestamp() < cutoff_time):
                tasks_to_remove.append(task_id)
        
        for task_id in tasks_to_remove:
            del self.tasks[task_id]
            logger.info(f"Cleaned up old task {task_id}")


# 全局服务实例
_async_summary_service: Optional[AsyncSummaryService] = None


def init_async_summary_service(sqlite_manager: SQLiteManager, llm_client: Optional[SiliconFlowClient] = None) -> None:
    """初始化异步总结服务"""
    global _async_summary_service
    _async_summary_service = AsyncSummaryService(sqlite_manager, llm_client)


def get_async_summary_service() -> Optional[AsyncSummaryService]:
    """获取异步总结服务实例"""
    return _async_summary_service