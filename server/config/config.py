import json
import logging
from pathlib import Path
from typing import Any, Dict


class ServerConfig:
    """服务器配置"""

    HOST = "0.0.0.0"
    PORT = 8000
    DEBUG = True

    PROJECT_ROOT = Path(__file__).parent.parent.parent

    BGE_M3_MODEL_PATH = PROJECT_ROOT / "meta" / "embedding" / "bge-m3"
    BGE_RERANKER_MODEL_PATH = PROJECT_ROOT / "meta" / "reranker" / "bge-reranker-v2-m3"

    BM25S_WEIGHT = 0.7
    EMBEDDING_WEIGHT = 0.3

    TEXT_SPLITTER_TYPE = "recursive"

    RECURSIVE_CHUNK_SIZE = 300
    RECURSIVE_CHUNK_OVERLAP = 80
    RECURSIVE_SEPARATORS = ["\n\n", "\n", " ", ""]


class DatabaseConfig:
    """数据库配置"""

    PROJECT_ROOT = Path(__file__).parent.parent.parent

    DATABASE_DIR = PROJECT_ROOT / "data"
    SQLITE_DIR = PROJECT_ROOT / "meta" / "sqlite"
    VECTOR_DIR = PROJECT_ROOT / "meta" / "vector"
    IMAGES_DIR = PROJECT_ROOT / "meta" / "images"

    SQLITE_DB_PATH = SQLITE_DIR / "documents.db"
    VECTOR_INDEX_PATH = VECTOR_DIR / "vector_index.faiss"
    VECTOR_METADATA_PATH = VECTOR_DIR / "vector_metadata.json"
    IMAGE_VECTOR_INDEX_PATH = VECTOR_DIR / "image_vector_index.faiss"
    IMAGE_VECTOR_METADATA_PATH = VECTOR_DIR / "image_vector_metadata.json"

    @classmethod
    def ensure_directories(cls) -> None:
        cls.DATABASE_DIR.mkdir(parents=True, exist_ok=True)
        cls.SQLITE_DIR.mkdir(parents=True, exist_ok=True)
        cls.VECTOR_DIR.mkdir(parents=True, exist_ok=True)
        cls.IMAGES_DIR.mkdir(parents=True, exist_ok=True)


_LOG = logging.getLogger(__name__)
_RUNTIME_PATH = Path(__file__).with_name('config_runtime.json')

_ALLOWED_SERVER_CONFIG_KEYS = {
    'RECURSIVE_CHUNK_SIZE': int,
    'RECURSIVE_CHUNK_OVERLAP': int,
    'BM25S_WEIGHT': float,
    'EMBEDDING_WEIGHT': float,
}

DEFAULT_RETRIEVAL_CONFIG = {
    'RECURSIVE_CHUNK_SIZE': ServerConfig.RECURSIVE_CHUNK_SIZE,
    'RECURSIVE_CHUNK_OVERLAP': ServerConfig.RECURSIVE_CHUNK_OVERLAP,
    'BM25S_WEIGHT': ServerConfig.BM25S_WEIGHT,
    'EMBEDDING_WEIGHT': ServerConfig.EMBEDDING_WEIGHT,
}

_RUNTIME_OVERRIDES: Dict[str, Any] = {}


def _coerce_config_value(key: str, value: Any) -> Any:
    if key not in _ALLOWED_SERVER_CONFIG_KEYS:
        raise ValueError(f"Unsupported config key: {key}")

    target_type = _ALLOWED_SERVER_CONFIG_KEYS[key]
    try:
        coerced = target_type(value)
    except (TypeError, ValueError) as error:
        raise ValueError(f"Invalid value for {key}: {value}") from error

    if key == 'RECURSIVE_CHUNK_SIZE':
        coerced = max(0, min(2000, int(coerced)))
    elif key == 'RECURSIVE_CHUNK_OVERLAP':
        coerced = max(0, min(500, int(coerced)))
    else:
        coerced = max(0.0, min(1.0, float(coerced)))

    return coerced


def _apply_overrides(overrides: Dict[str, Any]) -> None:
    for key, value in overrides.items():
        setattr(ServerConfig, key, value)


def _load_runtime_overrides() -> None:
    if not _RUNTIME_PATH.exists():
        return

    try:
        with _RUNTIME_PATH.open('r', encoding='utf-8') as file:
            data = json.load(file)
    except Exception as error:  # pylint: disable=broad-except
        _LOG.warning('Failed to read runtime config: %s', error)
        return

    if not isinstance(data, dict):
        return

    sanitized: Dict[str, Any] = {}
    for key, value in data.items():
        if key not in _ALLOWED_SERVER_CONFIG_KEYS:
            continue
        try:
            sanitized[key] = _coerce_config_value(key, value)
        except ValueError:
            continue

    if not sanitized:
        return

    chunk_size = sanitized.get('RECURSIVE_CHUNK_SIZE', ServerConfig.RECURSIVE_CHUNK_SIZE)
    chunk_overlap = sanitized.get('RECURSIVE_CHUNK_OVERLAP', ServerConfig.RECURSIVE_CHUNK_OVERLAP)
    if chunk_overlap > chunk_size:
        sanitized.pop('RECURSIVE_CHUNK_OVERLAP', None)

    bm25_weight = sanitized.get('BM25S_WEIGHT', ServerConfig.BM25S_WEIGHT)
    embedding_weight = sanitized.get('EMBEDDING_WEIGHT', ServerConfig.EMBEDDING_WEIGHT)
    if (bm25_weight + embedding_weight) <= 0:
        sanitized.pop('BM25S_WEIGHT', None)
        sanitized.pop('EMBEDDING_WEIGHT', None)

    _RUNTIME_OVERRIDES.update(sanitized)
    _apply_overrides(_RUNTIME_OVERRIDES)


def _write_runtime_overrides() -> None:
    if not _RUNTIME_OVERRIDES:
        if _RUNTIME_PATH.exists():
            try:
                _RUNTIME_PATH.unlink()
            except OSError as error:
                _LOG.warning('Failed to remove runtime config: %s', error)
        return

    try:
        _RUNTIME_PATH.parent.mkdir(parents=True, exist_ok=True)
        with _RUNTIME_PATH.open('w', encoding='utf-8') as file:
            json.dump(_RUNTIME_OVERRIDES, file, indent=2, ensure_ascii=False)
    except Exception as error:  # pylint: disable=broad-except
        _LOG.warning('Failed to persist runtime config: %s', error)


def get_retrieval_config() -> Dict[str, Any]:
    return {
        'RECURSIVE_CHUNK_SIZE': ServerConfig.RECURSIVE_CHUNK_SIZE,
        'RECURSIVE_CHUNK_OVERLAP': ServerConfig.RECURSIVE_CHUNK_OVERLAP,
        'BM25S_WEIGHT': ServerConfig.BM25S_WEIGHT,
        'EMBEDDING_WEIGHT': ServerConfig.EMBEDDING_WEIGHT,
    }


def get_default_retrieval_config() -> Dict[str, Any]:
    return dict(DEFAULT_RETRIEVAL_CONFIG)


def update_server_config(updates: Dict[str, Any]) -> Dict[str, Any]:
    if not updates:
        return get_retrieval_config()

    sanitized: Dict[str, Any] = {}
    for key, value in updates.items():
        if key not in _ALLOWED_SERVER_CONFIG_KEYS:
            continue
        sanitized[key] = _coerce_config_value(key, value)

    if not sanitized:
        return get_retrieval_config()

    chunk_size = sanitized.get('RECURSIVE_CHUNK_SIZE', ServerConfig.RECURSIVE_CHUNK_SIZE)
    chunk_overlap = sanitized.get('RECURSIVE_CHUNK_OVERLAP', ServerConfig.RECURSIVE_CHUNK_OVERLAP)
    if chunk_overlap > chunk_size:
        raise ValueError('recursive_chunk_overlap cannot exceed recursive_chunk_size')

    bm25_weight = sanitized.get('BM25S_WEIGHT', ServerConfig.BM25S_WEIGHT)
    embedding_weight = sanitized.get('EMBEDDING_WEIGHT', ServerConfig.EMBEDDING_WEIGHT)
    if (bm25_weight + embedding_weight) <= 0:
        raise ValueError('At least one of bm25s_weight or embedding_weight must be greater than 0')

    _RUNTIME_OVERRIDES.update(sanitized)
    _apply_overrides(_RUNTIME_OVERRIDES)
    _write_runtime_overrides()

    return get_retrieval_config()


def reset_server_config() -> Dict[str, Any]:
    _RUNTIME_OVERRIDES.clear()
    _apply_overrides(DEFAULT_RETRIEVAL_CONFIG)
    _write_runtime_overrides()
    return get_retrieval_config()


_load_runtime_overrides()
