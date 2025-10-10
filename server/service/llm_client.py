import json
import logging
from typing import Any, Dict, Generator, Optional

import requests
from requests import Response
from requests.exceptions import RequestException, Timeout


logger = logging.getLogger(__name__)


class LLMClientError(Exception):
  """统一的大模型调用异常。"""

  def __init__(self, message: str, status_code: Optional[int] = None, payload: Optional[Any] = None) -> None:
    super().__init__(message)
    self.status_code = status_code
    self.payload = payload


class SiliconFlowClient:
  """SiliconFlow Chat Completions 客户端"""

  def __init__(self, endpoint: str = "https://api.siliconflow.cn/v1/chat/completions", timeout: int = 60) -> None:
    self.endpoint = endpoint
    self.timeout = timeout

  def _build_headers(self, api_key: str) -> Dict[str, str]:
    return {
      "Authorization": f"Bearer {api_key}",
      "Content-Type": "application/json",
      "Accept": "application/json",
      "Accept-Charset": "utf-8"
    }

  def _handle_error_response(self, response: Response) -> None:
    status = response.status_code
    text = response.text.strip()
    if status in {401, 404}:
      raise LLMClientError(text or response.reason, status_code=status)
    try:
      data = response.json()
    except ValueError:
      raise LLMClientError(text or f"Unexpected response ({status})", status_code=status)
    message = data.get("message") or data.get("detail") or response.reason or "请求失败"
    raise LLMClientError(message, status_code=status, payload=data)

  def chat_completion(self, api_key: str, payload: Dict[str, Any]) -> Dict[str, Any]:
    headers = self._build_headers(api_key)
    cleaned_payload = dict(payload)
    cleaned_payload.pop("stream", None)
    try:
      response = requests.post(
        self.endpoint,
        json=cleaned_payload,
        headers=headers,
        timeout=self.timeout
      )
    except (Timeout, RequestException) as exc:
      raise LLMClientError(str(exc)) from exc

    if response.status_code != 200:
      self._handle_error_response(response)

    try:
      return response.json()
    except ValueError as exc:
      raise LLMClientError("无法解析模型返回的数据") from exc

  def stream_chat(self, api_key: str, payload: Dict[str, Any]) -> Generator[Dict[str, Any], None, None]:
    headers = self._build_headers(api_key)
    stream_payload = dict(payload)
    stream_payload["stream"] = True

    try:
      response = requests.post(
        self.endpoint,
        json=stream_payload,
        headers=headers,
        timeout=self.timeout,
        stream=True
      )
    except (Timeout, RequestException) as exc:
      raise LLMClientError(str(exc)) from exc

    if response.status_code != 200:
      self._handle_error_response(response)

    # 强制将上游流编码设置为 UTF-8，避免 requests 误判导致中文乱码
    response.encoding = 'utf-8'

    for raw_line in response.iter_lines(decode_unicode=True):
      if raw_line is None:
        continue
      line = raw_line.strip()
      if not line:
        continue
      if line.startswith("data:"):
        line = line[5:].strip()
      if not line or line == "[DONE]":
        continue
      try:
        event = json.loads(line)
      except json.JSONDecodeError:
        logger.debug("忽略无法解析的流数据: %s", line)
        continue
      yield event
