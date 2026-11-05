"""Shared API contract types for the caption bridge."""

from __future__ import annotations

import math
from typing import Any, Literal, Optional

from pydantic import BaseModel, Field, model_validator


class Token(BaseModel):
    surface: str
    reading: str = ""
    lemma: str = ""
    start: int = 0
    end: int = 0
    freq_rank: Optional[int] = None
    pos: str = ""
    # Approximate JLPT band from frequency (n5…n1); None → UI uses level-unknown
    jlpt: Optional[str] = None


class VocabWord(BaseModel):
    surface: str
    lemma: str = ""
    reading: str = ""
    freq_rank: int = 0


class VocabBand(BaseModel):
    band: int
    words: list[VocabWord] = Field(default_factory=list)


class VocabBandsResponse(BaseModel):
    bands: list[VocabBand] = Field(default_factory=list)
    preview_source: str = ""
    preview_tokens: list[Token] = Field(default_factory=list)


class Caps(BaseModel):
    max_in_flight: int = 3
    max_fps: int = 10
    w_ocr: int = 0
    w_mt: int = 0


class HealthResponse(BaseModel):
    ready: bool
    ocr_engine: str = ""
    models_loaded: dict[str, bool] = Field(default_factory=dict)
    mt_engine: str = ""
    glossary_forms: int = 0
    caps: Caps = Field(default_factory=Caps)
    pressure: Literal["low", "high"] = "low"
    latency_p50_ms: float = 0.0
    tokenize_batch_p95_ms: float = 0.0
    cache_hit_ratio: float = 0.0
    active_slots: int = 0
    bootstrap: Optional[dict[str, Any]] = None


class TokenizeRequest(BaseModel):
    """Sudachi + JLPT/freq only (import enrich / furigana)."""

    text: str = Field("", max_length=8192)


class TokenizeResponse(BaseModel):
    source: str = ""
    tokens: list[Token] = Field(default_factory=list)


class SegmentCueIn(BaseModel):
    id: str = Field("", max_length=128)
    text: str = Field(..., max_length=2048)


class TokenizeBatchRequest(BaseModel):
    # A batch is one import pass over a video's cues; an unbounded list would
    # queue thousands of Sudachi tokenizations in a single request.
    cues: list[SegmentCueIn] = Field(default_factory=list, max_length=2000)


class TokenizeBatchItem(BaseModel):
    id: str = ""
    source: str = ""
    tokens: list[Token] = Field(default_factory=list)


class TokenizeBatchResponse(BaseModel):
    results: list[TokenizeBatchItem] = Field(default_factory=list)


class DictRequest(BaseModel):
    surface: str = Field(..., max_length=512)
    lemma: str = Field("", max_length=256)
    sentence_id: str = Field("", max_length=128)
    context_tokens: list[str] = Field(default_factory=list)


class DictExample(BaseModel):
    ja: str = ""
    vi: str = ""
    trans: str = ""


class DictSense(BaseModel):
    gloss_en: list[str] = Field(default_factory=list)
    gloss_vi: list[str] = Field(default_factory=list)
    reading: str = ""
    pos: list[str] = Field(default_factory=list)


class DictResponse(BaseModel):
    surface: str
    matched: str = ""
    reading: str = ""
    hanviet: str = ""
    found: bool = False
    glosses_vi: list[str] = Field(default_factory=list)
    senses: list[DictSense] = Field(default_factory=list)
    message: str = ""
    jlpt: str = ""
    source: str = "Mazii JA-VI"
    examples: list[DictExample] = Field(default_factory=list)


class BootstrapProgress(BaseModel):
    stage: str
    percent: float
    message: str = ""
    done: bool = False


class ScriptCue(BaseModel):
    """Wire cue — no tokens; those live in tokens.json / GET /scripts/{id}/tokens."""

    id: str = ""
    start_media_time: float = 0.0
    end_media_time: float = 0.0
    source: str = ""
    en: str = ""
    vi: str = ""
    translated: bool = False
    text_source: str = "yt"
    # User/import owns EN/VI (token enrich OK).
    mt_locked: bool = False
    translation_source: str = ""  # "" | "user" | "import"

    @model_validator(mode="after")
    def _times_sane(self) -> ScriptCue:
        # NaN/Inf/-∞ break JSON, sort order and the player; reject at the boundary.
        for name in ("start_media_time", "end_media_time"):
            v = getattr(self, name)
            if not math.isfinite(v) or v < 0:
                raise ValueError(f"{name} must be finite and >= 0, got {v!r}")
        if self.end_media_time < self.start_media_time:
            raise ValueError("end_media_time must not be before start_media_time")
        return self


class ScriptCueIn(ScriptCue):
    """Save side still accepts inline tokens; the store splits them out."""

    tokens: list[Any] = Field(default_factory=list)


class ScriptSaveRequest(BaseModel):
    video_id: str
    cues: list[ScriptCueIn] = Field(default_factory=list)
    url: str = ""
    title: str = ""
    owned: Optional[bool] = None
    rev: Optional[int] = None


class ScriptSaveResponse(BaseModel):
    ok: bool = True
    video_id: str = ""
    path: str = ""
    txt_path: str = ""
    cue_count: int = 0
    translated_count: int = 0
    rev: int = 0
    message: str = ""


class ScriptFilesRequest(BaseModel):
    """Drive → disk mirror: {"files": {"cues.json": "...", ...}}."""

    files: dict[str, str] = Field(default_factory=dict)


class ScriptLoadResponse(BaseModel):
    ok: bool = True
    found: bool = False
    video_id: str = ""
    path: str = ""
    cues: list[ScriptCue] = Field(default_factory=list)
    meta: dict[str, Any] = Field(default_factory=dict)
    cue_count: int = 0
    translated_count: int = 0
    message: str = ""


class ImeSwitchRequest(BaseModel):
    """macOS Input Source: ja on JA focus; restore/abc on blur/Enter."""

    to: Literal["ja", "abc", "restore"]


class ExtensionStateRequest(BaseModel):
    """Mirror of chrome.storage.local keys for localhost Saved Items sync."""

    userVocab: Optional[dict[str, str]] = None
    hardsubSettings: Optional[dict[str, Any]] = None
    savedCues: Optional[dict[str, Any]] = None
    source: str = ""

    @model_validator(mode="before")
    @classmethod
    def _validate_vocab(cls, data):
        if isinstance(data, dict):
            vocab = data.get("userVocab")
            if vocab and isinstance(vocab, dict):
                valid = {}
                for k, v in vocab.items():
                    key = str(k).strip()
                    if key and len(key) <= 128 and v in ("known", "learning", "ignored", "special"):
                        valid[key] = v
                data["userVocab"] = valid
        return data


class ExtensionStateResponse(BaseModel):
    ok: bool = True
    userVocab: dict[str, str] = Field(default_factory=dict)
    hardsubSettings: Optional[dict[str, Any]] = None
    savedCues: dict[str, Any] = Field(default_factory=dict)
    updatedAt: float = 0.0
    source: str = ""


class VerifyTranscriptRequest(BaseModel):
    """Payload to verify factual claims or summaries against a video transcript."""

    video_id: str
    query: str
    transcript_text: str
    force_deep: bool = True
    provider: Literal["mock", "gemini"] = "gemini"


class VerifyTranscriptResponse(BaseModel):
    """Result of the anti-hallucination verification."""

    ok: bool = True
    is_reliable: bool
    final_answer: str
    verified_facts_count: int
    unverified_gaps: list[str] = Field(default_factory=list)
    token_usage: dict[str, int] = Field(default_factory=dict)

