"""Local bridge FastAPI: tokenize + dict + scripts for YouTube caption extension."""

from __future__ import annotations

import logging
import os
from contextlib import asynccontextmanager
from typing import AsyncIterator

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.asr import router as asr_router
from app.api.captions import router as captions_router
from app.api.dict import router as dict_router
from app.api.health import router as health_router
from app.api.ime import router as ime_router
from app.api.saved_items import router as saved_items_router
from app.api.scripts import router as scripts_router
from app.api.state import load_ext_state_disk
from app.api.state import router as state_router
from app.api.tokenize import router as tokenize_router
from app.api.verify import router as verify_router
from app.core.governor import governor
from app.services.dictionary import load_dictionary
from app.services.ime_switch import ensure_helper
from app.services.tokenize_ja import load_tokenizer
from app.services.vocab_freq import load_freq

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("bridge")


def check_single_worker() -> None:
    """Fail fast when the bridge is started with more than one uvicorn worker.

    Every piece of bridge state is per process (governor slots, the Sudachi
    tokenizer, the shared dictionary handle, the per-video save locks), so a
    second worker silently breaks the contract. local-bridge/start.sh starts
    uvicorn with --workers 1 for exactly this reason.
    """
    raw = os.environ.get("WEB_CONCURRENCY") or os.environ.get("UVICORN_WORKERS") or ""
    try:
        workers = int(raw)
    except ValueError:
        return
    if workers > 1:
        logger.error(
            "Refusing to start with %d uvicorn workers: the governor, the "
            "tokenizer cache, the dictionary handle and the per-video locks are "
            "per-process. Start the bridge with --workers 1 (local-bridge/start.sh).",
            workers,
        )
        raise RuntimeError(
            f"multiple uvicorn workers ({workers}) break the per-process bridge state"
        )


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
    check_single_worker()
    governor.start()
    load_ext_state_disk()
    try:
        load_dictionary()
        load_freq()
    except Exception:
        logger.exception("Warm load partial failure")
    # Warm the tokenizer and the IME helper here: doing it lazily inside a
    # request handler blocks that request (the swiftc build alone can take
    # two minutes) and duplicates the work under concurrent requests.
    try:
        load_tokenizer()
    except Exception:
        logger.exception("Sudachi preload failed")
    try:
        ensure_helper()
    except Exception:
        logger.exception("IME helper build failed")
    try:
        yield
    finally:
        governor.stop()


app = FastAPI(
    title="YouTube JP Caption Studio Bridge", version="0.3.0", lifespan=lifespan
)
app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"^(chrome-extension://[a-z0-9]{32}|http://(localhost|127\.0\.0\.1)(:\d+)?)$",
    # No cookies/sessions — credentials would let any localhost page send
    # credentialed mutation requests; auth is per-request (or loopback-only).
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health_router)
app.include_router(captions_router)
app.include_router(tokenize_router)
app.include_router(dict_router)
app.include_router(scripts_router)
app.include_router(ime_router)
app.include_router(state_router)
app.include_router(saved_items_router)
app.include_router(asr_router)
app.include_router(verify_router)


@app.get("/")
def root() -> dict[str, str]:
    return {"service": "youtube-caption-bridge", "docs": "/docs"}
