"""ASR router: audio transcription endpoints using MLX Whisper."""

from __future__ import annotations

import asyncio
import logging
from typing import Any, Dict, Optional

from fastapi import APIRouter, File, HTTPException, Query, Request, UploadFile

from app.core.governor import governor
from app.utils.logging_utils import append_errors_log
from app.services.asr import (
    DEFAULT_INITIAL_PROMPT,
    DEFAULT_MODEL_NAME,
    MAX_AUDIO_BYTES,
    get_asr_status,
    resolve_model_name,
    transcribe_audio,
)

logger = logging.getLogger("bridge.asr_api")

router = APIRouter(prefix="/asr", tags=["asr"])


_READ_CHUNK_BYTES = 1024 * 1024


def _payload_too_large() -> HTTPException:
    return HTTPException(
        status_code=413,
        detail=f"Audio payload exceeds maximum size limit ({MAX_AUDIO_BYTES // (1024 * 1024)} MB)",
    )


async def _read_capped_upload(file: UploadFile) -> bytes:
    """Read an upload in chunks and stop as soon as the limit is passed.

    Reading the whole file first and checking the size afterwards lets a client
    make the bridge buffer an arbitrary amount of memory before it says no.
    """
    chunks: list[bytes] = []
    total = 0
    while True:
        chunk = await file.read(_READ_CHUNK_BYTES)
        if not chunk:
            break
        total += len(chunk)
        if total > MAX_AUDIO_BYTES:
            raise _payload_too_large()
        chunks.append(chunk)
    return b"".join(chunks)


async def _read_capped_body(request: Request) -> bytes:
    """Same cap for a raw body: read the stream, stop at the limit."""
    chunks: list[bytes] = []
    total = 0
    async for chunk in request.stream():
        total += len(chunk)
        if total > MAX_AUDIO_BYTES:
            raise _payload_too_large()
        chunks.append(chunk)
    return b"".join(chunks)


@router.get("/status")
def asr_status() -> Dict[str, Any]:
    """Get runtime status and memory statistics of the ASR engine."""
    return get_asr_status()


@router.post("/transcribe")
async def transcribe(
    request: Request,
    file: Optional[UploadFile] = File(None),
    model: str = Query(DEFAULT_MODEL_NAME, description="Allowlisted model repository"),
    language: str = Query("ja", description="Target language code"),
    temperature: float = Query(0.0, description="Decoding temperature"),
    condition_on_previous_text: bool = Query(False, description="Condition on previous text"),
    no_speech_threshold: float = Query(0.85, description="No speech threshold"),
    logprob_threshold: float = Query(-1.5, description="Average logprob threshold"),
    initial_prompt: Optional[str] = Query(DEFAULT_INITIAL_PROMPT, description="Initial prompt context"),
    preprocess: bool = Query(True, description="Enable audio DSP preprocessing filter chain"),
    fp16: bool = Query(False, description="Use float16 (True) or float32 (False, recommended)"),
    word_timestamps: bool = Query(False, description="Return optional per-word timestamps"),
) -> Dict[str, Any]:
    """Transcribe audio slice and return text and segment timestamps.

    Supports:
    - Multipart form upload with field `file`.
    - Raw binary body payload (e.g., audio/webm, audio/wav, application/octet-stream).
    """
    # Check the model before reading the body: an unknown repo must not cost a
    # 50 MB upload, and it must never reach `path_or_hf_repo`.
    try:
        model_name = resolve_model_name(model)
    except ValueError as exc:
        logger.warning("Rejected ASR request for an unsupported model: %s", model)
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    audio_bytes: bytes = b""

    # 1. Read from uploaded file if present
    if file is not None:
        try:
            audio_bytes = await _read_capped_upload(file)
        except HTTPException:
            raise
        except Exception:
            logger.exception("Failed reading the uploaded audio file")
            raise HTTPException(status_code=400, detail="Failed to read audio file")
    else:
        # 2. Otherwise read raw request body
        declared = request.headers.get("content-length")
        if declared and declared.isdigit() and int(declared) > MAX_AUDIO_BYTES:
            # The client declared the size: reject without reading a single byte.
            raise _payload_too_large()
        try:
            audio_bytes = await _read_capped_body(request)
        except HTTPException:
            raise
        except Exception:
            logger.exception("Failed reading the ASR request body")
            raise HTTPException(status_code=400, detail="Failed to read request body")

    # Validate non-empty payload
    if not audio_bytes or len(audio_bytes) == 0:
        raise HTTPException(status_code=400, detail="Audio data cannot be empty")

    # Heavy path: take a governor slot like /tokenize does, otherwise several
    # MLX transcriptions can pile up on the Metal allocator.
    if not governor.try_acquire():
        raise HTTPException(status_code=503, detail="bridge busy")

    try:
        result = await asyncio.to_thread(
            transcribe_audio,
            audio_input=audio_bytes,
            model_name=model_name,
            language=language,
            temperature=temperature,
            condition_on_previous_text=condition_on_previous_text,
            no_speech_threshold=no_speech_threshold,
            logprob_threshold=logprob_threshold,
            initial_prompt=initial_prompt,
            preprocess=preprocess,
            fp16=fp16,
            word_timestamps=word_timestamps,
        )
        return result

    except ValueError as e:
        # Service-authored validation messages only: decode failures are
        # sanitized in the service so no ffmpeg internals reach the caller.
        logger.warning("Invalid audio payload for ASR: %s", e)
        raise HTTPException(status_code=400, detail=str(e))
    except RuntimeError as e:
        logger.exception("ASR runtime failure")
        # AGENTS.md §6: a runtime failure also belongs in errors.log, not only stderr.
        append_errors_log("ERROR", f"asr transcribe runtime failure: {type(e).__name__}")
        raise HTTPException(status_code=500, detail="ASR transcription failed")
    except Exception as e:
        logger.exception("Unexpected ASR error")
        append_errors_log("ERROR", f"asr transcribe unexpected error: {type(e).__name__}")
        raise HTTPException(status_code=500, detail="ASR transcription failed")
    finally:
        governor.release()
