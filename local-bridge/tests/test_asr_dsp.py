"""Unit and integration tests for ASR DSP filtering and decoding parameters."""

from __future__ import annotations

import io
import os
import json
import sys
import types
from pathlib import Path

import numpy as np
import pytest
import soundfile as sf
from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parent.parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from app.main import app
import app.services.asr as asr_service
from app.services.asr import (
    build_audio_filter_chain,
    decode_audio_bytes,
    transcribe_audio,
)
from scripts.asr_benchmark import (
    compute_cer_details,
    evaluate_windows,
    normalize_ja_text,
)

client = TestClient(app)


def make_sine_wav(
    freq: float = 1000.0,
    duration_sec: float = 1.0,
    sr: int = 16000,
    amplitude: float = 0.5,
) -> bytes:
    """Generate in-memory synthetic sine wave WAV bytes."""
    t = np.linspace(0, duration_sec, int(sr * duration_sec), endpoint=False, dtype=np.float32)
    sig = amplitude * np.sin(2 * np.pi * freq * t)
    buf = io.BytesIO()
    sf.write(buf, sig, sr, format="WAV", subtype="FLOAT")
    return buf.getvalue()


# -------------------------------------------------------------------------
# Unit Tests: DSP Filter Chain & Decoding
# -------------------------------------------------------------------------


def test_build_audio_filter_chain_default():
    """Default filter chain should contain highpass, lowpass, afftdn, and dynaudnorm with b=1."""
    chain = build_audio_filter_chain("enhanced")
    assert "highpass=f=100" in chain
    assert "lowpass=f=8000" in chain
    assert "afftdn=nf=-25" in chain
    assert "dynaudnorm" in chain
    assert "b=1" in chain or "altboundary=1" in chain
    assert "f=150" in chain
    assert "g=15" in chain


def test_build_audio_filter_chain_none():
    """Profile 'none' should return an empty filter string."""
    chain = build_audio_filter_chain("none")
    assert chain == ""


def test_build_audio_filter_chain_invalid():
    """Invalid profile should raise ValueError."""
    with pytest.raises(ValueError, match="Unknown filter profile"):
        build_audio_filter_chain("invalid_profile_xyz")


def test_dsp_amplifies_quiet_audio():
    """DSP pre-processing with dynaudnorm should amplify quiet audio (-30dB)."""
    # Quiet 1kHz sine wave (amplitude 0.03 ~ -30 dBFS)
    quiet_wav = make_sine_wav(freq=1000.0, duration_sec=1.0, sr=16000, amplitude=0.03)

    # Decode without preprocess
    raw_audio = decode_audio_bytes(quiet_wav, preprocess=False)
    # Decode with preprocess (DSP active)
    dsp_audio = decode_audio_bytes(quiet_wav, preprocess=True)

    raw_peak = float(np.max(np.abs(raw_audio)))
    dsp_peak = float(np.max(np.abs(dsp_audio)))

    assert raw_peak <= 0.05
    # DSP dynaudnorm should boost the quiet signal by at least 5x
    assert dsp_peak >= raw_peak * 5.0, f"Expected >= 5x amplification, got raw={raw_peak}, dsp={dsp_peak}"


def test_dsp_attenuates_low_frequency_rumble():
    """DSP highpass at 100Hz should attenuate sub-bass rumble relative to speech."""
    sr = 16000
    t = np.linspace(0, 1.0, sr, endpoint=False, dtype=np.float32)
    # Composite signal: equal parts 40Hz sub-bass rumble and 1000Hz speech tone
    mixed_sig = 0.3 * np.sin(2 * np.pi * 40 * t) + 0.3 * np.sin(2 * np.pi * 1000 * t)
    buf = io.BytesIO()
    sf.write(buf, mixed_sig, sr, format="WAV", subtype="FLOAT")

    dsp_audio = decode_audio_bytes(buf.getvalue(), preprocess=True)

    # Compute FFT magnitudes
    fft_mag = np.abs(np.fft.rfft(dsp_audio))
    freqs = np.fft.rfftfreq(len(dsp_audio), 1.0 / sr)

    mag_40 = float(np.max(fft_mag[np.abs(freqs - 40) < 5]))
    mag_1000 = float(np.max(fft_mag[np.abs(freqs - 1000) < 5]))

    # Sub-bass should have significantly less energy than speech (< 25%).
    ratio = mag_40 / mag_1000
    assert ratio < 0.25, f"40Hz rumble not attenuated enough, ratio to 1000Hz was {ratio:.3f}"


def test_dsp_preserves_length_finite_samples_and_peak_range():
    """The real filter output must remain a valid, same-length 16 kHz waveform."""
    sr = 16000
    t = np.linspace(0, 1.0, sr, endpoint=False, dtype=np.float32)
    mixed_sig = (
        0.2 * np.sin(2 * np.pi * 20 * t)
        + 0.2 * np.sin(2 * np.pi * 2000 * t)
        + 0.2 * np.sin(2 * np.pi * 10000 * t)
    )
    buf = io.BytesIO()
    sf.write(buf, mixed_sig, sr, format="WAV", subtype="FLOAT")

    dsp_audio = decode_audio_bytes(buf.getvalue(), preprocess=True)

    assert len(dsp_audio) == len(mixed_sig)
    assert np.all(np.isfinite(dsp_audio))
    assert float(np.max(np.abs(dsp_audio))) <= 1.0


def test_dsp_lowpass_rejects_ultrasonic_band_noise():
    """Energy above the 8 kHz speech band must fall relative to 2 kHz speech."""
    sr = 32000
    t = np.linspace(0, 1.0, sr, endpoint=False, dtype=np.float32)
    mixed_sig = 0.3 * np.sin(2 * np.pi * 2000 * t) + 0.3 * np.sin(2 * np.pi * 12000 * t)
    buf = io.BytesIO()
    sf.write(buf, mixed_sig, sr, format="WAV", subtype="FLOAT")

    dsp_audio = decode_audio_bytes(buf.getvalue(), preprocess=True)
    fft_mag = np.abs(np.fft.rfft(dsp_audio))
    freqs = np.fft.rfftfreq(len(dsp_audio), 1.0 / sr)
    high_band = float(np.max(fft_mag[np.abs(freqs - 12000) < 50]))
    speech_band = float(np.max(fft_mag[np.abs(freqs - 2000) < 50]))

    assert high_band / speech_band < 0.25


def test_decode_audio_bytes_preprocess_toggle():
    """When preprocess=False, WAV bytes should bypass DSP and match soundfile."""
    wav_bytes = make_sine_wav(freq=440.0, duration_sec=0.5, sr=16000, amplitude=0.2)
    raw = decode_audio_bytes(wav_bytes, preprocess=False)
    assert np.max(np.abs(raw)) <= 0.25


# -------------------------------------------------------------------------
# Integration Tests: transcribe_audio & API with Decoding Parameters
# -------------------------------------------------------------------------



# Loading a real MLX model in-process crashes the interpreter on exit (native
# MLX/Metal static destructor, order-dependent — 2026-10-22 audit B-1). These
# tests exercise the real transcription path, so they are opt-in: without the
# flag a plain `pytest -q tests/` used to exit 139 after reporting "passed".
_real_mlx = pytest.mark.skipif(
    os.environ.get("JP_RUN_MLX_TESTS") != "1",
    reason="loads a real MLX model; set JP_RUN_MLX_TESTS=1 to run",
)

@_real_mlx
def test_transcribe_audio_parameters():
    """transcribe_audio should accept all Tier 2 parameters without error."""
    pytest.importorskip("mlx_whisper")
    wav_bytes = make_sine_wav(freq=440.0, duration_sec=1.0, sr=16000, amplitude=0.2)
    res = transcribe_audio(
        wav_bytes,
        condition_on_previous_text=False,
        no_speech_threshold=0.85,
        logprob_threshold=-1.5,
        initial_prompt="こんにちは。テストです。",
        preprocess=True,
    )
    assert "text" in res
    assert "segments" in res
    assert res["durationSec"] == 1.0


@_real_mlx
def test_asr_api_transcribe_with_tuning_params():
    """POST /asr/transcribe should accept query parameters for DSP and decoding."""
    pytest.importorskip("mlx_whisper")
    wav_bytes = make_sine_wav(freq=440.0, duration_sec=1.0, sr=16000, amplitude=0.2)
    response = client.post(
        "/asr/transcribe",
        params={
            "condition_on_previous_text": "false",
            "no_speech_threshold": 0.85,
            "logprob_threshold": -1.5,
            "initial_prompt": "こんにちは。テストです。",
            "preprocess": "true",
        },
        content=wav_bytes,
        headers={"Content-Type": "audio/wav"},
    )
    assert response.status_code == 200
    data = response.json()
    assert "text" in data
    assert "segments" in data
    assert data["durationSec"] == 1.0


# -------------------------------------------------------------------------
# Unit Tests: Benchmark Metrics & Normalization
# -------------------------------------------------------------------------


def test_normalize_ja_text_rules():
    """normalize_ja_text should lowercase Latin, strip brackets/punctuation, preserve prolonged mark ー and 々."""
    raw = "【音楽】 (拍手) ワープロ [雑音] ABC 人々。"
    norm = normalize_ja_text(raw)
    assert norm == "ワープロabc人々"


def test_compute_cer_details_breakdown():
    """compute_cer_details should compute exact substitutions, deletions, insertions."""
    # Test case with 1 substitution and 1 insertion
    res_ins = compute_cer_details("あいうえ", "あいかえき")
    assert res_ins["substitutions"] == 1
    assert res_ins["deletions"] == 0
    assert res_ins["insertions"] == 1
    assert res_ins["cer"] == 0.5
    assert res_ins["insertionRate"] == 0.25

    # Test case with 1 substitution and 1 deletion
    res_del = compute_cer_details("あいうえおか", "あいさおか")
    assert res_del["substitutions"] == 1
    assert res_del["deletions"] == 1
    assert res_del["insertions"] == 0
    assert res_del["cer"] == round(2 / 6, 4)
    assert res_del["deletionRate"] == round(1 / 6, 4)


def test_evaluate_windows_structure(tmp_path: Path):
    """evaluate_windows should produce summary with baseline and multi-model evaluations."""
    manifest_file = tmp_path / "test_manifest.json"
    manifest_content = {
        "schemaVersion": 1,
        "windows": [
            {
                "id": "win-01",
                "referenceHypothesis": "テストです",
                "sourceAsr": "テスト[音楽]です",
                "errorCategory": "bgm",
            }
        ],
    }
    manifest_file.write_text(json.dumps(manifest_content), encoding="utf-8")

    preds = {
        "win-01": {
            "model-a [dsp_on]": {"text": "テストです", "rtf": 0.05, "elapsedSec": 0.1},
            "model-a [dsp_off]": {"text": "テスト", "rtf": 0.04, "elapsedSec": 0.08},
        }
    }
    summary = evaluate_windows(manifest_file, predictions=preds)
    assert summary["totalWindows"] == 1
    assert "baselineYouTube" in summary
    assert "modelEvaluations" in summary
    assert "model-a [dsp_on]" in summary["modelEvaluations"]
    assert summary["modelEvaluations"]["model-a [dsp_on]"]["meanNormCer"] == 0.0
    assert summary["modelEvaluations"]["model-a [dsp_off]"]["meanDeletionRate"] > 0.0


def test_slice_synthetic_challenge_audio(tmp_path: Path):
    """generate_synthetic_challenge_audio should create valid 16kHz mono audio."""
    from scripts.slice_real_challenge_audio import generate_synthetic_challenge_audio
    test_wav = tmp_path / "test_synthetic.wav"
    generate_synthetic_challenge_audio(test_wav, duration_sec=0.5, category="quiet_hall_reverb")
    assert test_wav.is_file()
    data, sr = sf.read(str(test_wav))
    assert sr == 16000
    assert data.ndim == 1
    assert len(data) == 8000


def test_apply_audio_dsp_float64_conversion():
    """apply_audio_dsp must handle float64 arrays without byte corruption or crashing."""
    from app.services.asr import apply_audio_dsp
    # Create float64 sine wave
    t = np.linspace(0, 0.5, 8000, endpoint=False, dtype=np.float64)
    sig_f64 = 0.2 * np.sin(2 * np.pi * 1000.0 * t)
    assert sig_f64.dtype == np.float64

    filtered = apply_audio_dsp(sig_f64, filter_profile="enhanced", sr=16000)
    assert filtered.dtype == np.float32
    assert filtered.ndim == 1
    assert len(filtered) > 0
    # Peak should remain finite and reasonable
    assert np.all(np.isfinite(filtered))
    assert np.max(np.abs(filtered)) <= 1.0


def test_decode_audio_bytes_missing_ffmpeg(monkeypatch):
    """When ffmpeg is not available, decode_audio_bytes must raise clean ValueError without UnboundLocalError."""
    import shutil
    from app.services.asr import decode_audio_bytes

    monkeypatch.setattr(shutil, "which", lambda cmd: None)

    # Invalid headerless 19-byte audio should fail with ValueError cleanly
    with pytest.raises(ValueError, match="Unable to decode audio format"):
        decode_audio_bytes(b"a" * 19, preprocess=False)


def test_evaluate_windows_flat_predictions_backward_compatibility(tmp_path: Path):
    """evaluate_windows should accept backward-compatible flat dict of predictions."""
    manifest_file = tmp_path / "test_flat_manifest.json"
    manifest_content = {
        "schemaVersion": 1,
        "windows": [
            {
                "id": "win-01",
                "referenceHypothesis": "テストです",
                "sourceAsr": "テスト",
            }
        ],
    }
    manifest_file.write_text(json.dumps(manifest_content), encoding="utf-8")

    # Flat dict mapping wid -> hyp string
    flat_preds = {"win-01": "テストです"}
    summary = evaluate_windows(manifest_file, predictions=flat_preds)
    assert summary["totalWindows"] == 1
    assert "modelEvaluations" in summary
    assert "default" in summary["modelEvaluations"]
    assert summary["modelEvaluations"]["default"]["meanNormCer"] == 0.0


def test_is_valid_speech_text():
    """is_valid_speech_text should reject punctuation-only strings and accept real speech text."""
    from app.services.asr import is_valid_speech_text

    assert not is_valid_speech_text("")
    assert not is_valid_speech_text("   ")
    assert not is_valid_speech_text("!")
    assert not is_valid_speech_text("！")
    assert not is_valid_speech_text("!?!?")
    assert not is_valid_speech_text("...")
    assert not is_valid_speech_text("。。。")
    assert not is_valid_speech_text(" 、 。 ! ？ - ~ ")

    assert is_valid_speech_text("こんにちは")
    assert is_valid_speech_text("テスト！")
    assert is_valid_speech_text("A")
    assert is_valid_speech_text("報道フロア")


def fake_mlx_whisper(monkeypatch):
    """Install a stub mlx_whisper module.

    mlx-whisper only installs on darwin/arm64, but asr.py imports it lazily
    inside transcribe_audio(), so a stub in sys.modules lets these pure-logic
    regressions run on every platform (the audit asked for exactly this).
    """
    module = types.ModuleType("mlx_whisper")
    module.transcribe = lambda *a, **k: {"text": "", "segments": []}
    monkeypatch.setitem(sys.modules, "mlx_whisper", module)
    return module


def test_transcribe_audio_fp16_and_kotoba_prompt_handling(monkeypatch):
    """transcribe_audio must default to fp16=False, suppress default initial_prompt for Kotoba, and sanitize audio."""
    mlx_whisper = fake_mlx_whisper(monkeypatch)
    from app.services.asr import DEFAULT_INITIAL_PROMPT

    captured_kwargs = {}

    def mock_transcribe(audio, **kwargs):
        captured_kwargs.update(kwargs)
        captured_kwargs["audio_array"] = audio
        return {"text": "テスト成功", "segments": [{"id": 0, "start": 0.0, "end": 1.0, "text": "テスト成功"}]}

    monkeypatch.setattr(mlx_whisper, "transcribe", mock_transcribe)

    wav_bytes = make_sine_wav(freq=440.0, duration_sec=1.0, sr=16000)

    # 1. Kotoba Whisper with default prompt -> fp16=False and initial_prompt=None
    res = transcribe_audio(
        wav_bytes,
        model_name="kaiinui/kotoba-whisper-v2.0-mlx",
        initial_prompt=DEFAULT_INITIAL_PROMPT,
    )
    assert captured_kwargs.get("fp16") is False
    assert captured_kwargs.get("initial_prompt") is None
    assert res["text"] == "テスト成功"

    # 2. Kotoba Whisper with explicit custom prompt -> custom prompt honored
    transcribe_audio(
        wav_bytes,
        model_name="kaiinui/kotoba-whisper-v2.0-mlx",
        initial_prompt="カスタムプロンプト",
    )
    assert captured_kwargs.get("initial_prompt") == "カスタムプロンプト"

    # 3. Explicit fp16=True passed
    transcribe_audio(
        wav_bytes,
        model_name="kaiinui/kotoba-whisper-v2.0-mlx",
        fp16=True,
    )
    assert captured_kwargs.get("fp16") is True


def test_transcribe_audio_audio_nan_sanitization(monkeypatch):
    """Input audio with NaN / Inf or out-of-range values must be sanitized to finite float32 in [-1.0, 1.0]."""
    mlx_whisper = fake_mlx_whisper(monkeypatch)

    passed_audio = None

    def mock_transcribe(audio, **kwargs):
        nonlocal passed_audio
        passed_audio = audio
        return {"text": "音声正常", "segments": [{"id": 0, "start": 0.0, "end": 1.0, "text": "音声正常"}]}

    monkeypatch.setattr(mlx_whisper, "transcribe", mock_transcribe)

    # Audio array with NaN, Inf, and values > 1.0
    bad_audio = np.array([0.5, np.nan, 2.5, -3.0, np.inf, -np.inf, 0.2] * 3000, dtype=np.float32)
    transcribe_audio(bad_audio, preprocess=False)

    assert passed_audio is not None
    assert np.all(np.isfinite(passed_audio))
    assert np.max(passed_audio) <= 1.0
    assert np.min(passed_audio) >= -1.0


def test_transcribe_audio_suppresses_token0_collapse(monkeypatch):
    """When mlx_whisper produces pure punctuation/token 0 collapse (e.g. '!'), transcribe_audio must suppress it."""
    mlx_whisper = fake_mlx_whisper(monkeypatch)

    def mock_transcribe_collapse(audio, **kwargs):
        return {
            "text": "!",
            "segments": [
                {"id": 0, "start": 0.0, "end": 1.0, "text": "!"},
                {"id": 1, "start": 1.0, "end": 2.0, "text": " ! ？ "},
            ],
        }

    monkeypatch.setattr(mlx_whisper, "transcribe", mock_transcribe_collapse)

    wav_bytes = make_sine_wav(freq=440.0, duration_sec=1.0, sr=16000)
    res = transcribe_audio(wav_bytes)

    assert res["text"] == ""
    assert res["segments"] == []


def test_transcribe_audio_passes_temperature_fallback_chain(monkeypatch):
    """A scalar temperature disables Whisper's compression-ratio/logprob retry loop.

    Measured on the official Kantei corpus (8 s slices, the extension's regime):
    a scalar 0.0 turned one window's 38.2% CER into 92.0% (600 inserted chars of
    repeated '日本語の字幕'); Kotoba window g03 hallucinated 71 chars the same way.
    The retry ladder is what stops those loops, so the bridge must hand
    mlx_whisper a tuple whenever the caller asks for greedy decoding.
    """
    mlx_whisper = fake_mlx_whisper(monkeypatch)
    captured = {}

    def mock_transcribe(audio, **kwargs):
        captured.update(kwargs)
        return {"text": "テスト", "segments": []}

    monkeypatch.setattr(mlx_whisper, "transcribe", mock_transcribe)
    wav_bytes = make_sine_wav(freq=440.0, duration_sec=1.0, sr=16000)

    transcribe_audio(wav_bytes, temperature=0.0)
    assert captured["temperature"] == (0.0, 0.2, 0.4, 0.6, 0.8, 1.0)

    transcribe_audio(wav_bytes, temperature=0.4)
    assert captured["temperature"] == (0.4,)


def test_transcribe_audio_does_not_decode_pure_silence(monkeypatch):
    """Digital silence must not reach the model at all.

    Both allowlisted models fabricate text when handed silence: turbo returned
    '日本語の字幕です。' and 'ご視聴ありがとうございました', Kotoba returned 'B'
    and 'ごめん'. no_speech_threshold and the prompt do not stop it, so the
    bridge has to refuse the window before decoding.
    """
    mlx_whisper = fake_mlx_whisper(monkeypatch)
    calls = []

    def mock_transcribe(audio, **kwargs):
        calls.append(audio)
        return {"text": "日本語の字幕です。", "segments": [{"id": 0, "start": 0.0, "end": 3.0, "text": "日本語の字幕です。"}]}

    monkeypatch.setattr(mlx_whisper, "transcribe", mock_transcribe)

    silence = np.zeros(16000 * 3, dtype=np.float32)
    res = transcribe_audio(silence, preprocess=False)

    assert calls == [], "silence was decoded instead of being skipped"
    assert res["text"] == ""
    assert res["segments"] == []
    assert res["skipped"] == "silence"


def test_transcribe_audio_still_decodes_quiet_speech(monkeypatch):
    """The silence gate must not swallow quiet-but-real speech.

    The quietest reference window peaks at 0.06 RMS; a gate tuned above that
    would drop real captions.
    """
    mlx_whisper = fake_mlx_whisper(monkeypatch)
    calls = []

    def mock_transcribe(audio, **kwargs):
        calls.append(audio)
        return {"text": "小さな声", "segments": []}

    monkeypatch.setattr(mlx_whisper, "transcribe", mock_transcribe)

    t = np.linspace(0, 2.0, 32000, endpoint=False, dtype=np.float32)
    quiet = (0.06 * np.sin(2 * np.pi * 200 * t)).astype(np.float32)
    res = transcribe_audio(quiet, preprocess=False)

    assert len(calls) == 1
    assert res["text"] == "小さな声"


def test_silence_gate_ignores_dsp_amplification(monkeypatch):
    """The gate must judge the input, not the normalised output.

    Measured over real HTTP: 0.001 RMS room noise was skipped with
    preprocess=false but decoded with preprocess=true, where dynaudnorm raises
    it to ~0.011 RMS and turbo answered '日本語の字幕です。'.
    """
    mlx_whisper = fake_mlx_whisper(monkeypatch)
    calls = []

    def mock_transcribe(audio, **kwargs):
        calls.append(audio)
        return {"text": "日本語の字幕です。", "segments": []}

    monkeypatch.setattr(mlx_whisper, "transcribe", mock_transcribe)

    rng = np.random.default_rng(7)
    room_noise = rng.normal(0, 0.001, 16000 * 3).astype(np.float32)
    res = transcribe_audio(room_noise, preprocess=True)

    assert calls == [], "DSP amplification let near-silence reach the model"
    assert res["text"] == ""
    assert res["skipped"] == "silence"


def test_text_only_result_is_marked_as_synthesized(monkeypatch):
    mlx_whisper = fake_mlx_whisper(monkeypatch)
    monkeypatch.setattr(
        mlx_whisper,
        "transcribe",
        lambda *args, **kwargs: {"text": "字幕だけ", "segments": []},
    )
    t = np.linspace(0, 1.0, 16000, endpoint=False, dtype=np.float32)
    audio = (0.1 * np.sin(2 * np.pi * 440 * t)).astype(np.float32)

    result = transcribe_audio(audio, preprocess=False)

    assert result["timestampSource"] == "synthesized-full-window"
    assert result["segments"][0]["start"] == 0.0
    assert result["segments"][0]["end"] == 1.0


def test_punctuation_only_native_segment_is_marked_as_synthesized(monkeypatch):
    mlx_whisper = fake_mlx_whisper(monkeypatch)
    monkeypatch.setattr(
        mlx_whisper,
        "transcribe",
        lambda *args, **kwargs: {
            "text": "字幕だけ",
            "segments": [{"start": 0.0, "end": 1.0, "text": "!"}],
        },
    )
    t = np.linspace(0, 1.0, 16000, endpoint=False, dtype=np.float32)
    audio = (0.1 * np.sin(2 * np.pi * 440 * t)).astype(np.float32)

    result = transcribe_audio(audio, preprocess=False)

    assert result["timestampSource"] == "synthesized-full-window"


def test_mlx_audio_model_loader_is_cached_per_server(monkeypatch):
    """A server must load an MLX-Audio model once, not once per audio window."""
    calls = []
    fake_model = object()
    fake_stt = types.SimpleNamespace(load=lambda name: calls.append(name) or fake_model)
    fake_package = types.SimpleNamespace(stt=fake_stt)
    monkeypatch.setitem(sys.modules, "mlx_audio", fake_package)
    monkeypatch.setitem(sys.modules, "mlx_audio.stt", fake_stt)
    asr_service._load_mlx_audio_model.cache_clear()

    first = asr_service._load_mlx_audio_model("fake/model")
    second = asr_service._load_mlx_audio_model("fake/model")

    assert first is fake_model
    assert second is fake_model
    assert calls == ["fake/model"]
    asr_service._load_mlx_audio_model.cache_clear()
