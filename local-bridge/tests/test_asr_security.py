"""ASR trust boundary: model allowlist, sanitized errors, governor slot, per-request Metal peak.

Regression tests for the P1 findings of review/full-codebase-improvement-audit-2026-10-18.md
(services section): the `model` query param reached `path_or_hf_repo` unchecked, the
endpoint echoed raw ffmpeg/MLX internals, the heavy path skipped the governor and the
Metal peak counter was never reset.
"""

from __future__ import annotations

import io
import sys
import threading
import time
import types
from types import SimpleNamespace

import numpy as np
import pytest
import soundfile as sf
from fastapi import HTTPException
from fastapi.testclient import TestClient

from app.main import app
from app.services import asr as asr_service

client = TestClient(app)


def make_wav(duration_sec: float = 1.0, sr: int = 16000) -> bytes:
    t = np.linspace(0, duration_sec, int(sr * duration_sec), endpoint=False, dtype=np.float32)
    buf = io.BytesIO()
    sf.write(buf, 0.2 * np.sin(2 * np.pi * 440 * t), sr, format="WAV", subtype="FLOAT")
    return buf.getvalue()


@pytest.fixture
def fake_mlx(monkeypatch):
    """Stand-ins for mlx_whisper / mlx.core so the ASR path runs without Metal."""
    state = {"peak": 0, "resets": 0, "calls": [], "in_flight": 0, "max_in_flight": 0}

    mlx = types.ModuleType("mlx")
    mlx.__path__ = []  # type: ignore[attr-defined]
    core = types.ModuleType("mlx.core")

    def get_peak_memory():
        return state["peak"]

    def reset_peak_memory():
        state["resets"] += 1
        state["peak"] = 0

    core.get_peak_memory = get_peak_memory
    core.reset_peak_memory = reset_peak_memory
    # MLX Audio receives an mx.array; the fake keeps it as a NumPy array so
    # dispatch tests measure our contract instead of requiring Metal.
    core.array = lambda value, dtype=None: np.asarray(value, dtype=np.float32)
    core.clear_cache = lambda: None
    mlx.core = core  # type: ignore[attr-defined]

    def transcribe(audio, **kwargs):
        state["calls"].append(kwargs)
        state["in_flight"] += 1
        state["max_in_flight"] = max(state["max_in_flight"], state["in_flight"])
        try:
            time.sleep(0.05)
            state["peak"] = 1234
            return {
                "text": "テスト",
                "segments": [{"id": 0, "start": 0.0, "end": 1.0, "text": "テスト"}],
            }
        finally:
            state["in_flight"] -= 1

    whisper = types.ModuleType("mlx_whisper")
    whisper.transcribe = transcribe  # type: ignore[attr-defined]

    monkeypatch.setitem(sys.modules, "mlx", mlx)
    monkeypatch.setitem(sys.modules, "mlx.core", core)
    monkeypatch.setitem(sys.modules, "mlx_whisper", whisper)
    return state


# ---------------------------------------------------------------------------
# model allowlist
# ---------------------------------------------------------------------------


def test_service_rejects_an_unknown_model_without_downloading(fake_mlx):
    """An unknown repo must never reach path_or_hf_repo."""
    audio = np.zeros(16000, dtype=np.float32)
    with pytest.raises(ValueError, match="unsupported model"):
        asr_service.transcribe_audio(
            audio, model_name="attacker/arbitrary-repo", preprocess=False
        )
    assert fake_mlx["calls"] == [], "the model was handed to the engine anyway"


def test_service_accepts_the_allowlisted_models(fake_mlx):
    audio = np.zeros(16000, dtype=np.float32)
    for name in asr_service.ALLOWED_MODELS:
        out = asr_service.transcribe_audio(audio, model_name=name, preprocess=False)
        assert out["model"] == name


def test_benchmark_allowlist_is_opt_in_and_never_arbitrary(monkeypatch):
    benchmark_model = "mlx-community/parakeet-tdt_ctc-0.6b-ja"
    monkeypatch.delenv(asr_service.BENCHMARK_ALLOWLIST_ENV, raising=False)
    with pytest.raises(ValueError, match="unsupported model"):
        asr_service.resolve_model_name(benchmark_model)

    monkeypatch.setenv(asr_service.BENCHMARK_ALLOWLIST_ENV, "1")
    assert asr_service.resolve_model_name(benchmark_model) == benchmark_model
    with pytest.raises(ValueError, match="unsupported model"):
        asr_service.resolve_model_name("attacker/arbitrary-repo")


@pytest.mark.parametrize(
    ("model_name", "result", "expected_language"),
    [
        (
            "mlx-community/parakeet-tdt_ctc-0.6b-ja",
            SimpleNamespace(
                text="パラキート",
                sentences=[SimpleNamespace(start=0.0, end=1.0, text="パラキート")],
            ),
            None,
        ),
        (
            "mlx-community/Qwen3-ASR-1.7B-8bit",
            SimpleNamespace(
                text="クウェン",
                segments=[{"start": 0.0, "end": 1.0, "text": "クウェン"}],
            ),
            "Japanese",
        ),
    ],
)
def test_service_routes_mlx_audio_models_without_leaking_unsupported_kwargs(
    monkeypatch, fake_mlx, model_name, result, expected_language
):
    calls = []

    class FakeModel:
        def __init__(self, *, accepts_language):
            if accepts_language:
                self.generate = self.generate_with_language
            else:
                self.generate = self.generate_without_language

        def generate_with_language(self, audio, *, language=None, temperature=0.0):
            calls.append({"language": language, "temperature": temperature, "audio": audio})
            return result

        def generate_without_language(self, audio, *, chunk_duration=None):
            calls.append({"chunk_duration": chunk_duration, "audio": audio})
            return result

    stt = types.ModuleType("mlx_audio.stt")
    stt.load = lambda name: FakeModel(
        accepts_language=name == "mlx-community/Qwen3-ASR-1.7B-8bit"
    )
    package = types.ModuleType("mlx_audio")
    package.__path__ = []  # type: ignore[attr-defined]
    package.stt = stt  # type: ignore[attr-defined]
    monkeypatch.setitem(sys.modules, "mlx_audio", package)
    monkeypatch.setitem(sys.modules, "mlx_audio.stt", stt)
    monkeypatch.setenv(asr_service.BENCHMARK_ALLOWLIST_ENV, "1")

    audio = 0.2 * np.sin(
        2 * np.pi * 440 * np.linspace(0, 1.0, 16000, endpoint=False, dtype=np.float32)
    )
    out = asr_service.transcribe_audio(audio, model_name=model_name, preprocess=False)

    assert out["backend"] == "mlx_audio"
    assert out["timestampSource"] == "native"
    assert out["text"] == result.text
    assert calls and calls[0]["language" if expected_language else "chunk_duration"] == expected_language


def test_normalize_words_keeps_only_well_formed_speech_timestamps():
    words = asr_service._normalize_words(
        [
            {"word": "今日", "start": 0, "end": 0.42},
            {"text": "は", "start": "0.42", "end": "0.71"},
            {"word": "!", "start": 0.71, "end": 0.8},
            {"word": "負", "start": -0.1, "end": 0.9},
            {"word": "逆", "start": 1.0, "end": 0.9},
            {"word": "無限", "start": float("nan"), "end": 1.2},
            {"word": "欠落", "start": 1.2},
        ]
    )

    assert words == [
        {"text": "今日", "start": 0.0, "end": 0.42},
        {"text": "は", "start": 0.42, "end": 0.71},
    ]


def test_normalize_engine_result_preserves_optional_word_timestamps():
    full_text, segments, timestamp_source = asr_service._normalize_engine_result(
        {
            "text": "今日は晴れ",
            "segments": [
                {
                    "start": 0.0,
                    "end": 1.0,
                    "text": "今日は晴れ",
                    "words": [
                        {"word": "今日", "start": 0.0, "end": 0.3},
                        {"word": "は", "start": 0.3, "end": 0.4},
                        {"word": "晴れ", "start": 0.4, "end": 1.0},
                    ],
                }
            ],
        },
        1.0,
    )

    assert full_text == "今日は晴れ"
    assert timestamp_source == "native"
    assert segments[0]["words"] == [
        {"text": "今日", "start": 0.0, "end": 0.3},
        {"text": "は", "start": 0.3, "end": 0.4},
        {"text": "晴れ", "start": 0.4, "end": 1.0},
    ]


def test_service_passes_word_timestamp_flag_to_whisper(fake_mlx):
    audio = 0.2 * np.sin(
        2 * np.pi * 440 * np.linspace(0, 1.0, 16000, endpoint=False, dtype=np.float32)
    )
    asr_service.transcribe_audio(audio, preprocess=False, word_timestamps=True)
    assert fake_mlx["calls"][-1]["word_timestamps"] is True


def test_endpoint_returns_word_timestamps_without_requiring_them(fake_mlx, monkeypatch):
    whisper = sys.modules["mlx_whisper"]
    calls = []

    def transcribe_with_words(*args, **kwargs):
        calls.append(kwargs)
        return {
            "text": "今日は晴れ",
            "segments": [
                {
                    "id": 0,
                    "start": 0.0,
                    "end": 1.0,
                    "text": "今日は晴れ",
                    "words": [
                        {"word": "今日", "start": 0.0, "end": 0.3},
                        {"word": "は", "start": 0.3, "end": 0.4},
                        {"word": "晴れ", "start": 0.4, "end": 1.0},
                    ],
                }
            ],
        }

    monkeypatch.setattr(whisper, "transcribe", transcribe_with_words)

    resp = client.post(
        "/asr/transcribe",
        params={"preprocess": "false", "word_timestamps": "true"},
        content=make_wav(),
        headers={"Content-Type": "audio/wav"},
    )

    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert calls[-1]["word_timestamps"] is True
    assert body["segments"][0]["words"] == [
        {"text": "今日", "start": 0.0, "end": 0.3},
        {"text": "は", "start": 0.3, "end": 0.4},
        {"text": "晴れ", "start": 0.4, "end": 1.0},
    ]


def test_endpoint_rejects_an_unknown_model(fake_mlx):
    resp = client.post(
        "/asr/transcribe",
        params={"model": "attacker/arbitrary-repo"},
        content=make_wav(),
        headers={"Content-Type": "audio/wav"},
    )
    assert resp.status_code == 400
    assert "unsupported model" in resp.json()["detail"]
    assert fake_mlx["calls"] == []


def test_endpoint_serves_an_allowlisted_model(fake_mlx):
    resp = client.post(
        "/asr/transcribe",
        params={"model": asr_service.DEFAULT_MODEL_NAME, "preprocess": "false"},
        content=make_wav(),
        headers={"Content-Type": "audio/wav"},
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["model"] == asr_service.DEFAULT_MODEL_NAME


def test_endpoint_defaults_to_dsp_on(fake_mlx):
    """A request without an explicit preprocess flag keeps the production default."""
    resp = client.post(
        "/asr/transcribe",
        params={"model": asr_service.DEFAULT_MODEL_NAME},
        content=make_wav(),
        headers={"Content-Type": "audio/wav"},
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["preprocess"] is True


# ---------------------------------------------------------------------------
# sanitized error details
# ---------------------------------------------------------------------------


def test_decode_failure_does_not_leak_ffmpeg_internals(monkeypatch):
    """A decode failure must answer with a stable message, not the tool output."""
    # No ffmpeg on PATH: the decoder ends in its "cannot decode" branch.
    monkeypatch.setattr(asr_service.shutil, "which", lambda name: None)
    with pytest.raises(ValueError) as exc:
        asr_service.decode_audio_bytes(b"NOT_REAL_AUDIO_BYTES_12345")
    assert str(exc.value) == "Unable to decode audio format"


def test_decode_failure_message_has_no_tool_output(monkeypatch):
    """The ffmpeg error text stays in the log, not in the exception message."""
    calls: list[str] = []
    monkeypatch.setattr(asr_service.shutil, "which", lambda name: None)
    with pytest.raises(ValueError) as exc:
        asr_service.decode_audio_bytes(b"NOT_REAL_AUDIO_BYTES_12345")
    detail = str(exc.value)
    for leak in ("soundfile", "ffmpeg", "error (", "sndfile"):
        assert leak not in detail.lower(), detail


def test_engine_failure_does_not_leak_mlx_internals(monkeypatch, fake_mlx):
    def boom(*a, **k):
        raise RuntimeError("mlx internal detail /Users/me/private")

    monkeypatch.setattr(asr_service, "get_metal_peak_memory_bytes", lambda: None)
    monkeypatch.setitem(sys.modules, "mlx_whisper", types.SimpleNamespace(transcribe=boom))
    resp = client.post(
        "/asr/transcribe",
        params={"preprocess": "false"},
        content=make_wav(),
        headers={"Content-Type": "audio/wav"},
    )
    assert resp.status_code == 500
    body = resp.text
    assert "mlx internal detail" not in body
    assert "/Users/me/private" not in body


# ---------------------------------------------------------------------------
# governor slot on the heavy path
# ---------------------------------------------------------------------------


def test_endpoint_returns_503_when_the_governor_is_saturated(monkeypatch, fake_mlx):
    from app.core.governor import governor

    monkeypatch.setattr(governor, "try_acquire", lambda: False)
    resp = client.post(
        "/asr/transcribe",
        params={"preprocess": "false"},
        content=make_wav(),
        headers={"Content-Type": "audio/wav"},
    )
    assert resp.status_code == 503
    assert fake_mlx["calls"] == []


def test_endpoint_releases_the_governor_slot(monkeypatch, fake_mlx):
    from app.core.governor import governor

    released = []
    monkeypatch.setattr(governor, "release", lambda: released.append(True))
    resp = client.post(
        "/asr/transcribe",
        params={"preprocess": "false"},
        content=make_wav(),
        headers={"Content-Type": "audio/wav"},
    )
    assert resp.status_code == 200
    assert released, "the governor slot was not released"


def test_concurrent_transcriptions_do_not_overlap(fake_mlx):
    """Two first-loads would allocate the Metal model twice."""
    # Real signal: all-zero audio is now refused by the silence gate, which
    # would make this lock assertion pass without ever decoding.
    audio = 0.2 * np.sin(2 * np.pi * 440 * np.linspace(0, 1.0, 16000, endpoint=False, dtype=np.float32))
    errors: list[Exception] = []

    def run():
        try:
            asr_service.transcribe_audio(audio, preprocess=False)
        except Exception as exc:  # pragma: no cover - surfaced by the assert
            errors.append(exc)

    threads = [threading.Thread(target=run) for _ in range(4)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert not errors, errors
    assert fake_mlx["max_in_flight"] == 1, "two transcriptions ran at the same time"


# ---------------------------------------------------------------------------
# per-request Metal peak
# ---------------------------------------------------------------------------


def test_metal_peak_is_reset_before_every_transcription(fake_mlx):
    # Real signal: the silence gate would otherwise return before decoding and
    # report no Metal peak at all.
    audio = 0.2 * np.sin(2 * np.pi * 440 * np.linspace(0, 1.0, 16000, endpoint=False, dtype=np.float32))
    first = asr_service.transcribe_audio(audio, preprocess=False)
    assert first["metalPeakBytes"] == 1234

    # An unrelated allocation after the first request must not leak into the
    # next reading: the counter is process-wide.
    fake_mlx["peak"] = 999_999
    second = asr_service.transcribe_audio(audio, preprocess=False)
    assert second["metalPeakBytes"] == 1234
    assert fake_mlx["resets"] >= 2

# ---------------------------------------------------------------------------
# payload size cap
# ---------------------------------------------------------------------------

def test_oversized_raw_body_is_rejected_without_reading_all_of_it(monkeypatch, fake_mlx):
    """The bridge must stop reading at the limit, not buffer the whole body first."""
    from app.api import asr as asr_api

    monkeypatch.setattr(asr_api, "MAX_AUDIO_BYTES", 1024)
    resp = client.post(
        "/asr/transcribe",
        params={"preprocess": "false"},
        content=b"a" * 4096,
        headers={"Content-Type": "application/octet-stream"},
    )
    assert resp.status_code == 413, resp.text
    assert fake_mlx["calls"] == [], "an oversized payload must not reach the engine"

@pytest.mark.asyncio
async def test_capped_body_reader_stops_early(monkeypatch):
    """The raw-body reader must stop at the limit instead of buffering everything."""
    from app.api import asr as asr_api

    monkeypatch.setattr(asr_api, "MAX_AUDIO_BYTES", 1024)
    yielded = {"n": 0}

    class FakeRequest:
        async def stream(self):
            for _ in range(8):
                yielded["n"] += 1
                yield b"a" * 512

    with pytest.raises(HTTPException) as exc:
        await asr_api._read_capped_body(FakeRequest())
    assert exc.value.status_code == 413
    assert yielded["n"] < 8, f"the reader kept pulling ({yielded['n']} chunks)"

@pytest.mark.asyncio
async def test_capped_body_reader_returns_a_small_body(monkeypatch):
    from app.api import asr as asr_api

    monkeypatch.setattr(asr_api, "MAX_AUDIO_BYTES", 1024)

    class FakeRequest:
        async def stream(self):
            yield b"a" * 10
            yield b"b" * 20

    assert await asr_api._read_capped_body(FakeRequest()) == b"a" * 10 + b"b" * 20

def test_declared_content_length_over_the_limit_is_rejected_unread(monkeypatch, fake_mlx):
    """A declared size above the limit must be refused without touching the body."""
    from app.api import asr as asr_api

    monkeypatch.setattr(asr_api, "MAX_AUDIO_BYTES", 1024)
    resp = client.post(
        "/asr/transcribe",
        params={"preprocess": "false"},
        content=b"x" * 4096,
        headers={"Content-Type": "application/octet-stream"},
    )
    assert resp.status_code == 413, resp.text
    assert fake_mlx["calls"] == []

@pytest.mark.asyncio
async def test_capped_upload_reader_stops_early(monkeypatch):
    """The upload reader must not pull the whole file before it says no."""
    from app.api import asr as asr_api

    monkeypatch.setattr(asr_api, "MAX_AUDIO_BYTES", 1024)

    class FakeUpload:
        def __init__(self, data: bytes):
            self.data = data
            self.reads = 0

        async def read(self, size: int = -1) -> bytes:
            self.reads += 1
            chunk, self.data = self.data[:size], self.data[size:]
            return chunk

    upload = FakeUpload(b"y" * 8192)
    with pytest.raises(HTTPException) as exc:
        await asr_api._read_capped_upload(upload)
    assert exc.value.status_code == 413
    assert upload.reads <= 3, f"the reader kept pulling ({upload.reads} reads)"

@pytest.mark.asyncio
async def test_capped_upload_reader_returns_a_small_file(monkeypatch):
    from app.api import asr as asr_api

    monkeypatch.setattr(asr_api, "MAX_AUDIO_BYTES", 1024)

    class FakeUpload:
        def __init__(self, data: bytes):
            self.data = data

        async def read(self, size: int = -1) -> bytes:
            chunk, self.data = self.data[:size], self.data[size:]
            return chunk

    payload = await asr_api._read_capped_upload(FakeUpload(b"z" * 100))
    assert payload == b"z" * 100


def test_endpoint_rejects_benchmark_only_models(fake_mlx):
    """The five-model sweep was temporary; production keeps the measured winner."""
    benchmark_only = (
        "mlx-community/whisper-large-v3-turbo",
        "mlx-community/whisper-large-v3-mlx",
        "mlx-community/parakeet-tdt_ctc-0.6b-ja",
        "mlx-community/Qwen3-ASR-1.7B-8bit",
    )
    for name in benchmark_only:
        resp = client.post(
            "/asr/transcribe",
            params={"model": name},
            content=make_wav(),
            headers={"Content-Type": "audio/wav"},
        )
        assert resp.status_code == 400, (name, resp.text)
        assert "unsupported model" in resp.json()["detail"]
    assert fake_mlx["calls"] == []
