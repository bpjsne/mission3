"""
server.py — Thin Python/FastAPI proxy managed by supervisor (uvicorn on port 8001).
Spawns the Node.js Express server (server.js) on port 8002 at startup and
transparently forwards all requests — including SSE streaming — to it.
"""
import asyncio
import os
import subprocess
from pathlib import Path
from typing import AsyncGenerator

import httpx
from dotenv import load_dotenv
from fastapi import FastAPI, Request
from fastapi.responses import StreamingResponse, Response

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

NODE_PORT = int(os.environ.get("NODE_PORT", "8002"))
NODE_URL = f"http://localhost:{NODE_PORT}"

app = FastAPI()
_node_proc: subprocess.Popen | None = None

# Headers that must not be forwarded (hop-by-hop)
_DROP_REQ_HEADERS = frozenset({"host", "content-length", "transfer-encoding", "connection"})
_DROP_RESP_HEADERS = frozenset({"transfer-encoding", "connection"})


@app.on_event("startup")
async def _start_node() -> None:
    global _node_proc
    # Release port if held by a stale process
    os.system(f"fuser -k {NODE_PORT}/tcp 2>/dev/null; true")
    await asyncio.sleep(0.5)

    node_env = {**os.environ, "PORT": str(NODE_PORT)}
    _node_proc = subprocess.Popen(
        ["node", "server.js"],
        cwd=str(ROOT_DIR),
        env=node_env,
    )

    # Wait up to 15 s for Node.js to become ready
    async with httpx.AsyncClient() as client:
        for _ in range(30):
            try:
                r = await client.get(f"{NODE_URL}/api/", timeout=1.0)
                if r.status_code == 200:
                    break
            except Exception:
                pass
            await asyncio.sleep(0.5)


@app.on_event("shutdown")
async def _stop_node() -> None:
    if _node_proc:
        _node_proc.terminate()


@app.api_route(
    "/{path:path}",
    methods=["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
)
async def proxy(request: Request, path: str) -> Response:
    """Reverse-proxy: forward every request to Node.js, stream the response back."""
    url = f"{NODE_URL}/{path}"
    if request.url.query:
        url += f"?{request.url.query}"

    req_headers = {
        k: v for k, v in request.headers.items()
        if k.lower() not in _DROP_REQ_HEADERS
    }
    body = await request.body()

    # Use a per-request client so its lifetime matches the stream
    client = httpx.AsyncClient(timeout=httpx.Timeout(None))
    node_req = client.build_request(request.method, url, headers=req_headers, content=body)
    node_resp = await client.send(node_req, stream=True)

    resp_headers = {
        k: v for k, v in node_resp.headers.multi_items()
        if k.lower() not in _DROP_RESP_HEADERS
    }

    async def _body() -> AsyncGenerator[bytes, None]:
        try:
            async for chunk in node_resp.aiter_bytes(chunk_size=256):
                yield chunk
        finally:
            await node_resp.aclose()
            await client.aclose()

    return StreamingResponse(
        _body(),
        status_code=node_resp.status_code,
        headers=resp_headers,
        media_type=node_resp.headers.get("content-type"),
    )
