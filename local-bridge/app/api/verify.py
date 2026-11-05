"""Transcript and summary verification route powered by reliable-agent."""

from __future__ import annotations

import logging
from fastapi import APIRouter, HTTPException

from app.schemas.models import VerifyTranscriptRequest, VerifyTranscriptResponse
from app.services.script_store import validate_video_id

logger = logging.getLogger("bridge.verify")
router = APIRouter(prefix="/verify", tags=["verify"])


@router.post("/transcript", response_model=VerifyTranscriptResponse)
def verify_transcript(body: VerifyTranscriptRequest) -> VerifyTranscriptResponse:
    """Verify factual claims against a raw video transcript using reliable-agent."""
    try:
        vid = validate_video_id(body.video_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    if not body.transcript_text or not body.transcript_text.strip():
        raise HTTPException(status_code=400, detail="transcript_text cannot be empty")
    if not body.query or not body.query.strip():
        raise HTTPException(status_code=400, detail="query cannot be empty")

    from reliable_agent.orchestrator import Orchestrator
    from reliable_agent.providers.base import LLMProvider
    from reliable_agent.providers.gemini import GeminiProvider
    from reliable_agent.providers.mock import MockLLMProvider

    provider: LLMProvider
    if body.provider == "gemini":
        try:
            provider = GeminiProvider(
                verifier_model="gemini-2.5-flash",
                synthesis_model="gemini-2.5-flash",
            )
        except Exception as exc:
            logger.warning("GeminiProvider fallback to Mock: %s", exc)
            provider = MockLLMProvider()
    else:
        provider = MockLLMProvider()

    orchestrator = Orchestrator(provider=provider)
    source_url = f"video://{vid}"

    state = orchestrator.run(
        query=body.query,
        sources_data={source_url: body.transcript_text},
        force_deep=body.force_deep,
    )

    token_usage: dict[str, int] = {}
    if hasattr(provider, "usage"):
        u = getattr(provider, "usage")
        token_usage = {
            "api_calls": getattr(u, "api_calls", 0),
            "total_tokens": getattr(u, "total_tokens", 0),
        }

    return VerifyTranscriptResponse(
        ok=True,
        is_reliable=not state.abstained_completely and len(state.unverified_gaps) == 0,
        final_answer=state.final_answer or "",
        verified_facts_count=len(state.verified_facts),
        unverified_gaps=state.unverified_gaps,
        token_usage=token_usage,
    )
