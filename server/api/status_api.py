import asyncio
import logging
from datetime import datetime, timezone
from typing import Dict, Optional, Set

from fastapi import APIRouter, WebSocket, WebSocketDisconnect


logger = logging.getLogger(__name__)

router = APIRouter()


class StatusBroadcaster:
    """Tracks active WebSocket connections and pushes backend status updates."""

    def __init__(self) -> None:
        self._connections: Set[WebSocket] = set()
        self._lock = asyncio.Lock()
        self._latest_payload: Optional[Dict] = None

    async def connect(self, websocket: WebSocket) -> None:
        await websocket.accept()
        async with self._lock:
            self._connections.add(websocket)
        if self._latest_payload is not None:
            try:
                await websocket.send_json(self._latest_payload)
            except Exception:
                logger.exception("Failed to send initial status payload to websocket client")

    async def disconnect(self, websocket: WebSocket) -> None:
        async with self._lock:
            self._connections.discard(websocket)

    async def broadcast(self, payload: Dict, keep_latest: bool = True) -> None:
        """Send payload to all clients and optionally cache it for new connections."""
        timestamped_payload = {
            **payload,
            "timestamp": datetime.now(timezone.utc).isoformat()
        }
        if keep_latest:
            self._latest_payload = timestamped_payload

        async with self._lock:
            connections = list(self._connections)

        for connection in connections:
            try:
                await connection.send_json(timestamped_payload)
            except Exception:
                logger.debug("Dropping websocket client after broadcast failure", exc_info=True)
                await self.disconnect(connection)


status_broadcaster = StatusBroadcaster()


@router.websocket("/ws/status")
async def websocket_status(websocket: WebSocket) -> None:
    await status_broadcaster.connect(websocket)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        await status_broadcaster.disconnect(websocket)
    except Exception:
        logger.exception("Unexpected websocket error")
        await status_broadcaster.disconnect(websocket)
