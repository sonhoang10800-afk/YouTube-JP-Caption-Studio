"""ASR service using MLX Whisper on Apple Silicon Metal.

Provides:
1. Audio decoding from various containers (WebM Opus, WAV, OGG, PCM) to 16 kHz mono float32.
2. Input validation: size limits, zero-duration, negative/empty payloads, duration bounds.
3. Apple Silicon Metal-accelerated transcription using mlx_whisper.
4. Structured transcription output (text, segments with timestamps, RTF, RAM, Metal metrics).
"""

from __future__ import annotations

import io
import importlib.util
import inspect
import math
import logging
import os
import re
import resource
import shutil
import subprocess
import sys
import threading
import time
from functools import lru_cache
from typing import Any, Dict, List, Optional, Union

import numpy as np
import soundfile as sf
from scipy import signal

logger = logging.getLogger("bridge.asr")

TARGET_SAMPLE_RATE = 16000
MAX_AUDIO_BYTES = 50 * 1024 * 1024  # 50 MB
MAX_AUDIO_DURATION_SEC = 300.0       # 5 minutes
# A wedged ffmpeg must not pin the ASR worker thread forever.
FFMPEG_TIMEOUT_SEC = 60

MIN_AUDIO_DURATION_SEC = 0.05        # 50 ms
# The production model invents text from silence ("日本語の字幕です。",
# "ご視聴ありがとうございました"), and no decode parameter stops it. The gate sits
# far below real speech (the Kantei corpus' quietest window is ~0.077 RMS).
SILENCE_RMS_THRESHOLD = 0.002
# Greedy decoding alone has no compression-ratio/logprob retry: a failed window
# is returned as-is, which showed up as repeated-phrase loops. Asking for a
# tuple keeps the first pass greedy and enables Whisper's fallback ladder.
GREEDY_TEMPERATURE_FALLBACK = (0.0, 0.2, 0.4, 0.6, 0.8, 1.0)
DEFAULT_MODEL_NAME = "kaiinui/kotoba-whisper-v2.0-mlx"
DEFAULT_INITIAL_PROMPT = "こんにちは。日本語のYouTube動画の字幕です。"
DEFAULT_AUDIO_FILTER_CHAIN = (
    "highpass=f=100,lowpass=f=8000,afftdn=nf=-25,dynaudnorm=f=150:g=15:p=0.95:b=1"
)

# The five-model sweep found no gate winner, so production keeps the existing
# Kotoba model and DSP baseline. The request parameter reaches model loaders
# and must never accept an arbitrary repo.
ALLOWED_MODELS: tuple[str, ...] = (DEFAULT_MODEL_NAME,)
BENCHMARK_ALLOWLIST_ENV = "BRIDGE_ASR_ALLOW_BENCHMARK_MODELS"
BENCHMARK_MODELS: tuple[str, ...] = (
    "mlx-community/whisper-large-v3-turbo",
    "mlx-community/whisper-large-v3-mlx",
    "mlx-community/parakeet-tdt_ctc-0.6b-ja",
    "mlx-community/Qwen3-ASR-1.7B-8bit",
)
MODEL_BACKENDS: Dict[str, str] = {
    DEFAULT_MODEL_NAME: "mlx_whisper",
    "mlx-community/whisper-large-v3-turbo": "mlx_whisper",
    "mlx-community/whisper-large-v3-mlx": "mlx_whisper",
    "mlx-community/parakeet-tdt_ctc-0.6b-ja": "mlx_audio",
    "mlx-community/Qwen3-ASR-1.7B-8bit": "mlx_audio",
}
MLX_AUDIO_LANGUAGE_NAMES = {"ja": "Japanese", "en": "English", "zh": "Chinese"}

# One Metal model at a time: two concurrent first loads would allocate the
# same model twice and can exhaust unified memory.
_asr_lock = threading.Lock()


def resolve_model_name(model_name: str | None) -> str:
    """Map a requested model to an allowlisted repo id (ValueError if unknown)."""
    name = (model_name or "").strip() or DEFAULT_MODEL_NAME
    allowed = ALLOWED_MODELS
    if os.environ.get(BENCHMARK_ALLOWLIST_ENV) == "1":
        allowed = ALLOWED_MODELS + BENCHMARK_MODELS
    if name not in allowed:
        raise ValueError(
            "unsupported model; allowed: " + ", ".join(allowed)
        )
    return name


def get_model_backend(model_name: str) -> str:
    """Return the local inference backend for an allowlisted model repository."""
    return MODEL_BACKENDS.get(model_name, "mlx_whisper")


def is_valid_speech_text(text: str) -> bool:
    """Check whether transcribed text contains speech characters beyond whitespace and punctuation."""
    if not text:
        return False
    clean = re.sub(r"[\s!！?？.。,:：;；~～\-_—…·、。「」『』（）()\[\]【】]+", "", text)
    return len(clean) > 0




def is_probably_silence(audio: np.ndarray, threshold: float = SILENCE_RMS_THRESHOLD) -> bool:
    """True when the window carries no signal worth decoding."""
    samples = np.asarray(audio, dtype=np.float32).reshape(-1)
    if samples.size == 0:
        return True
    return bool(np.sqrt(np.mean(np.square(samples))) < threshold)


def build_audio_filter_chain(filter_profile: str = "enhanced") -> str:
    """Build FFmpeg audio filter chain for ASR speech enhancement.

    Profiles:
    - 'enhanced': 100Hz highpass, 8000Hz lowpass, -25dB FFT noise reduction,
                  dynamic audio normalizer with frame=150ms, odd Gaussian window g=15,
                  peak=0.95, and alternative boundary mode b=1 to preserve clip edges.
    - 'none': Passthrough with no filtering.
    """
    if filter_profile == "enhanced":
        return DEFAULT_AUDIO_FILTER_CHAIN
    if filter_profile == "none" or not filter_profile:
        return ""
    if any(k in filter_profile for k in ("highpass", "lowpass", "afftdn", "dynaudnorm", "volume", "equalizer")):
        return filter_profile
    raise ValueError(f"Unknown filter profile: {filter_profile}")


def apply_audio_dsp(
    audio: np.ndarray,
    filter_profile: str = "enhanced",
    sr: int = TARGET_SAMPLE_RATE,
) -> np.ndarray:
    """Apply FFmpeg audio DSP filter chain directly to 1D float32 audio array."""
    if audio.size == 0:
        return np.ascontiguousarray(audio, dtype=np.float32)
    chain = build_audio_filter_chain(filter_profile)
    if not chain:
        return np.ascontiguousarray(audio, dtype=np.float32)

    ffmpeg_bin = shutil.which("ffmpeg")
    if not ffmpeg_bin:
        logger.warning("ffmpeg not found, skipping DSP filter chain")
        return np.ascontiguousarray(audio, dtype=np.float32)

    # Ensure audio is contiguous 1D float32 array
    pcm_in = np.ascontiguousarray(audio.reshape(-1), dtype=np.float32)

    cmd = [
        ffmpeg_bin,
        "-y",
        "-f",
        "f32le",
        "-ar",
        str(sr),
        "-ac",
        "1",
        "-i",
        "pipe:0",
        "-af",
        chain,
        "-f",
        "f32le",
        "-ar",
        str(TARGET_SAMPLE_RATE),
        "-ac",
        "1",
        "pipe:1",
    ]
    try:
        proc = subprocess.run(
            cmd,
            input=pcm_in.tobytes(),
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            check=True,
            timeout=FFMPEG_TIMEOUT_SEC,
        )
        if proc.stdout and len(proc.stdout) > 0:
            valid_len = (len(proc.stdout) // 4) * 4
            filtered = np.frombuffer(proc.stdout[:valid_len], dtype=np.float32)
            if filtered.size > 0:
                return np.ascontiguousarray(filtered, dtype=np.float32)
    except Exception as e:
        logger.warning("Failed to apply FFmpeg DSP filter: %s", e)
    return pcm_in


def get_process_rss_bytes() -> int:
    """Get peak resident set size in bytes for the current process."""
    usage = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
    if sys.platform == "darwin":
        return usage
    return usage * 1024


def get_metal_peak_memory_bytes() -> Optional[int]:
    """Get Apple Silicon Metal peak memory usage if available."""
    try:
        import mlx.core as mx
        if hasattr(mx, "get_peak_memory"):
            return mx.get_peak_memory()
        if hasattr(mx, "metal") and hasattr(mx.metal, "get_peak_memory"):
            return mx.metal.get_peak_memory()
    except Exception as exc:
        logger.debug("Metal peak memory unavailable: %s", exc)
    return None


def reset_metal_peak_memory() -> None:
    """Reset the Metal peak counter so the next reading covers one request only.

    Without this the reported peak is the process-lifetime maximum, not the
    peak of the transcription that just ran.
    """
    try:
        import mlx.core as mx
        if hasattr(mx, "reset_peak_memory"):
            mx.reset_peak_memory()
        elif hasattr(mx, "metal") and hasattr(mx.metal, "reset_peak_memory"):
            mx.metal.reset_peak_memory()
    except Exception as exc:
        logger.debug("Metal peak memory reset unavailable: %s", exc)


def to_mono_float32(audio: np.ndarray) -> np.ndarray:
    """Downmix multi-channel audio to 1D mono float32."""
    if audio.size == 0:
        raise ValueError("Audio array cannot be empty")
    if audio.ndim > 2:
        raise ValueError(f"Expected 1D or 2D audio, got ndim={audio.ndim}")
    if audio.ndim == 2:
        # Standard soundfile layout: (samples, channels)
        if audio.shape[1] <= 8 and audio.shape[0] >= audio.shape[1]:
            audio = audio.mean(axis=1)
        elif audio.shape[0] <= 8:
            audio = audio.mean(axis=0)
        else:
            audio = audio.mean(axis=1)
    return np.ascontiguousarray(audio, dtype=np.float32)


def resample_to_16k(audio: np.ndarray, orig_sr: int) -> np.ndarray:
    """Resample 1D mono audio to 16,000 Hz using polyphase filtering."""
    if audio.size == 0:
        raise ValueError("Cannot resample empty audio")
    if orig_sr <= 0:
        raise ValueError(f"Sample rate must be positive: orig_sr={orig_sr}")
    if orig_sr == TARGET_SAMPLE_RATE:
        return np.ascontiguousarray(audio, dtype=np.float32)

    g = math.gcd(orig_sr, TARGET_SAMPLE_RATE)
    up = TARGET_SAMPLE_RATE // g
    down = orig_sr // g
    resampled = signal.resample_poly(audio, up, down)
    return np.ascontiguousarray(resampled, dtype=np.float32)


def decode_audio_bytes(
    data: bytes,
    preprocess: bool = False,
    filter_profile: str = "enhanced",
) -> np.ndarray:
    """Decode raw audio bytes into 16 kHz mono float32 numpy array.

    When preprocess=True, all supported inputs (WAV, WebM, OGG, etc.)
    are routed through FFmpeg with the speech enhancement filter chain.
    """
    if not data or len(data) == 0:
        raise ValueError("Audio data cannot be empty")
    if len(data) > MAX_AUDIO_BYTES:
        raise ValueError(f"Audio payload exceeds maximum size limit ({MAX_AUDIO_BYTES // (1024 * 1024)} MB)")

    ffmpeg_bin = shutil.which("ffmpeg")
    ffmpeg_err: Optional[Exception] = None
    sf_error: Optional[Exception] = None

    # 1. When DSP preprocessing is enabled and ffmpeg is present, route via FFmpeg filter pipe
    if preprocess and ffmpeg_bin:
        filter_chain = build_audio_filter_chain(filter_profile)
        cmd = [
            ffmpeg_bin,
            "-y",
            "-i",
            "pipe:0",
        ]
        if filter_chain:
            cmd.extend(["-af", filter_chain])
        cmd.extend([
            "-f",
            "f32le",
            "-ar",
            str(TARGET_SAMPLE_RATE),
            "-ac",
            "1",
            "pipe:1",
        ])
        try:
            proc = subprocess.run(
                cmd,
                input=data,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                check=True,
                timeout=FFMPEG_TIMEOUT_SEC,
            )
            if proc.stdout and len(proc.stdout) > 0:
                valid_len = (len(proc.stdout) // 4) * 4
                audio_arr = np.frombuffer(proc.stdout[:valid_len], dtype=np.float32)
                if audio_arr.size > 0:
                    return np.ascontiguousarray(audio_arr, dtype=np.float32)
        except Exception as err:
            ffmpeg_err = err
            logger.warning("ffmpeg pipe with DSP failed (%s), trying soundfile fallback", ffmpeg_err)

    # 2. Try reading via soundfile (fast for WAV/OGG without DSP or as fallback)
    try:
        bio = io.BytesIO(data)
        audio_arr, orig_sr = sf.read(bio)
        mono_arr = to_mono_float32(audio_arr)
        resampled_arr = resample_to_16k(mono_arr, orig_sr)
        if preprocess:
            resampled_arr = apply_audio_dsp(resampled_arr, filter_profile=filter_profile)
        return resampled_arr
    except Exception as e:
        sf_error = e

    # 3. Fallback to ffmpeg pipe without filter (handles WebM/Opus when preprocess=False)
    if ffmpeg_bin:
        cmd = [
            ffmpeg_bin,
            "-y",
            "-i",
            "pipe:0",
            "-f",
            "f32le",
            "-ar",
            str(TARGET_SAMPLE_RATE),
            "-ac",
            "1",
            "pipe:1",
        ]
        try:
            proc = subprocess.run(
                cmd,
                input=data,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                check=True,
                timeout=FFMPEG_TIMEOUT_SEC,
            )
            if not proc.stdout or len(proc.stdout) == 0:
                raise ValueError("ffmpeg output was empty")
            valid_len = (len(proc.stdout) // 4) * 4
            audio_arr = np.frombuffer(proc.stdout[:valid_len], dtype=np.float32)
            if audio_arr.size == 0:
                raise ValueError("Decoded audio contains no samples")
            if preprocess:
                audio_arr = apply_audio_dsp(audio_arr, filter_profile=filter_profile)
            return audio_arr
        except Exception as err:
            ffmpeg_err = err
            # 4. Direct raw PCM fallback (headerless float32 or int16 16kHz mono)
            if len(data) % 4 == 0:
                try:
                    raw_float = np.frombuffer(data, dtype=np.float32)
                    if raw_float.size > 0 and np.all(np.isfinite(raw_float)) and np.max(np.abs(raw_float)) <= 1.5:
                        arr = np.ascontiguousarray(raw_float, dtype=np.float32)
                        return apply_audio_dsp(arr, filter_profile=filter_profile) if preprocess else arr
                except Exception as exc:
                    logger.debug("Raw float32 PCM fallback failed: %s", exc)
            if len(data) % 2 == 0:
                try:
                    raw_i16 = np.frombuffer(data, dtype=np.int16)
                    if raw_i16.size > 0:
                        raw_float = raw_i16.astype(np.float32) / 32768.0
                        arr = np.ascontiguousarray(raw_float, dtype=np.float32)
                        return apply_audio_dsp(arr, filter_profile=filter_profile) if preprocess else arr
                except Exception as exc:
                    logger.debug("Raw int16 PCM fallback failed: %s", exc)
            logger.error("ffmpeg decoding error: %s", ffmpeg_err)
            # The ffmpeg/soundfile internals stay in the log, not in the
            # exception message: the API hands that text to the caller.
            raise ValueError("Unable to decode audio payload") from ffmpeg_err

    logger.error(
        "Unable to decode audio format: soundfile error (%s), ffmpeg error (%s)",
        sf_error,
        ffmpeg_err,
    )
    raise ValueError("Unable to decode audio format")


def transcribe_audio(
    audio_input: Union[bytes, np.ndarray],
    model_name: str = DEFAULT_MODEL_NAME,
    language: str = "ja",
    temperature: float = 0.0,
    condition_on_previous_text: bool = False,
    no_speech_threshold: float = 0.85,
    logprob_threshold: float = -1.5,
    initial_prompt: Optional[str] = DEFAULT_INITIAL_PROMPT,
    preprocess: bool = False,
    fp16: bool = False,
    word_timestamps: bool = False,
    compression_ratio_threshold: Optional[float] = 2.4,
    hallucination_silence_threshold: Optional[float] = None,
) -> Dict[str, Any]:
    """Transcribe audio using an allowlisted MLX backend on Apple Silicon.

    Parameters:
    - audio_input: Raw audio bytes or 16 kHz mono float32 numpy array.
    - model_name: Hugging Face repo or path for mlx_whisper model.
    - language: Target language code (e.g. 'ja').
    - temperature: Sampling temperature (0.0 for deterministic greedy decoding).
    - condition_on_previous_text: Set False to prevent repetition loops on music/noise.
    - no_speech_threshold: Set 0.85 to avoid dropping quiet whisper segments.
    - logprob_threshold: Set -1.5 for speech confidence threshold.
    - initial_prompt: Initial prompt context for Japanese YouTube domain.
    - preprocess: Enable FFmpeg audio DSP filter chain.
    - fp16: Use float16 (True) or float32 (False, recommended to prevent NaN overflow on Metal).
    - word_timestamps: Extract per-word timestamps if needed.
    - compression_ratio_threshold: Whisper compression ratio threshold.
    - hallucination_silence_threshold: Threshold to suppress hallucinations on silence.

    Returns:
    Dict with text, segments (id, start, end, text), durationSec, elapsedSec, rtf, model, ram metrics.
    """
    # Reject an unknown repo before any audio work: the value is caller
    # controlled and ends up in `path_or_hf_repo`.
    model_name = resolve_model_name(model_name)
    backend = get_model_backend(model_name)

    # DSP stays out of the decode step so the silence gate can judge the
    # signal the caller actually sent: dynaudnorm lifts room noise by ~10x,
    # which put near-silence straight back over the threshold.
    if isinstance(audio_input, bytes):
        audio = decode_audio_bytes(audio_input, preprocess=False)
    elif isinstance(audio_input, np.ndarray):
        audio = to_mono_float32(audio_input)
    else:
        raise ValueError(f"Unsupported audio input type: {type(audio_input)}")

    if audio.size == 0:
        raise ValueError("Audio array contains no samples")

    # Sanitize audio array against NaN / Inf and clamp to [-1.0, 1.0]
    audio = np.nan_to_num(audio, nan=0.0, posinf=0.0, neginf=0.0)
    audio = np.clip(audio, -1.0, 1.0)
    audio = np.ascontiguousarray(audio, dtype=np.float32)

    duration_sec = len(audio) / TARGET_SAMPLE_RATE
    if duration_sec < MIN_AUDIO_DURATION_SEC:
        raise ValueError(f"Audio duration is too short ({duration_sec:.3f}s < {MIN_AUDIO_DURATION_SEC}s)")
    if duration_sec > MAX_AUDIO_DURATION_SEC:
        raise ValueError(f"Audio duration exceeds {int(MAX_AUDIO_DURATION_SEC)} seconds limit ({duration_sec:.1f}s)")

    # Silence is not worth a model pass: decoding it produces invented
    # captions. Returning an empty result keeps the caller's contract intact.
    if is_probably_silence(audio):
        return {
            "text": "",
            "segments": [],
            "language": language,
            "durationSec": round(float(duration_sec), 3),
            "elapsedSec": 0.0,
            "rtf": 0.0,
            "model": model_name,
            "backend": backend,
            "preprocess": preprocess,
            "fp16": fp16,
            "timestampSource": "none",
            "rssBytes": get_process_rss_bytes(),
            "metalPeakBytes": None,
            "skipped": "silence",
        }

    if preprocess:
        audio = apply_audio_dsp(audio)
        audio = np.ascontiguousarray(
            np.clip(np.nan_to_num(audio, nan=0.0, posinf=0.0, neginf=0.0), -1.0, 1.0),
            dtype=np.float32,
        )

    rss_before = get_process_rss_bytes()
    start_time = time.perf_counter()

    # mlx_whisper only retries on compression-ratio/logprob failures when it
    # receives a temperature tuple; a bare float disables the ladder.
    decode_temperatures = (
        GREEDY_TEMPERATURE_FALLBACK if temperature == 0.0 else (temperature,)
    )

    try:
        # The Metal peak counter is process-wide: reset it so the reported
        # number covers this transcription, not the whole process lifetime.
        reset_metal_peak_memory()
        with _asr_lock:
            if backend == "mlx_audio":
                raw_result = _transcribe_with_mlx_audio(
                    audio,
                    model_name=model_name,
                    language=language,
                    temperature=temperature,
                )
            else:
                import mlx_whisper

                # Kotoba-Whisper is sensitive to prompts on short slices.
                effective_prompt = initial_prompt
                if initial_prompt == DEFAULT_INITIAL_PROMPT:
                    effective_prompt = None
                raw_result = mlx_whisper.transcribe(
                    audio,
                    path_or_hf_repo=model_name,
                    language=language,
                    fp16=fp16,
                    temperature=decode_temperatures,
                    condition_on_previous_text=condition_on_previous_text,
                    no_speech_threshold=no_speech_threshold,
                    logprob_threshold=logprob_threshold,
                    initial_prompt=effective_prompt,
                    word_timestamps=word_timestamps,
                    compression_ratio_threshold=compression_ratio_threshold,
                    hallucination_silence_threshold=hallucination_silence_threshold,
                )
    except Exception as e:
        logger.error("%s execution failed: %s", backend, e)
        # The MLX internals stay in the log; the caller only learns that the
        # transcription failed.
        raise RuntimeError("ASR transcription failed") from e

    elapsed_time = time.perf_counter() - start_time
    rss_after = get_process_rss_bytes()
    metal_peak = get_metal_peak_memory_bytes()

    full_text, raw_segments, timestamp_source = _normalize_engine_result(
        raw_result, duration_sec
    )

    # Filter out single-character punctuation / token 0 collapses (e.g. '!')
    if not is_valid_speech_text(full_text):
        full_text = ""

    segments = []
    for idx, seg in enumerate(raw_segments):
        if not isinstance(seg, dict):
            continue
        seg_text = str(seg.get("text", "")).strip()
        if not is_valid_speech_text(seg_text):
            continue
        segments.append({
            "id": int(seg.get("id", idx)),
            "start": round(float(seg.get("start", 0.0)), 3),
            "end": round(float(seg.get("end", 0.0)), 3),
            "text": seg_text,
            **({"words": words} if (words := _normalize_words(seg.get("words"))) else {}),
        })

    if not full_text and segments:
        full_text = " ".join(s["text"] for s in segments)

    rtf = elapsed_time / duration_sec if duration_sec > 0 else 0.0

    return {
        "text": full_text,
        "segments": segments,
        "language": language,
        "durationSec": round(float(duration_sec), 3),
        "elapsedSec": round(float(elapsed_time), 3),
        "rtf": round(float(rtf), 4),
        "model": model_name,
        "backend": backend,
        "preprocess": preprocess,
        "fp16": fp16,
        "timestampSource": timestamp_source,
        "rssBytes": max(rss_before, rss_after),
        "metalPeakBytes": metal_peak,
    }


def _transcribe_with_mlx_audio(
    audio: np.ndarray,
    *,
    model_name: str,
    language: str,
    temperature: float,
) -> Any:
    """Run one MLX-Audio STT model without importing it for Whisper requests."""
    import mlx.core as mx

    model = _load_mlx_audio_model(model_name)
    generate_params = inspect.signature(model.generate).parameters
    kwargs: Dict[str, Any] = {}
    if "language" in generate_params:
        kwargs["language"] = MLX_AUDIO_LANGUAGE_NAMES.get(language, language)
    if "temperature" in generate_params:
        kwargs["temperature"] = temperature
    return model.generate(mx.array(audio), **kwargs)


def _normalize_words(raw_words: Any) -> List[Dict[str, Any]]:
    """Normalize optional engine word timestamps without inventing times."""
    if not isinstance(raw_words, (list, tuple)):
        return []
    words: List[Dict[str, Any]] = []
    for raw in raw_words:
        if isinstance(raw, dict):
            text = raw.get("word", raw.get("text", ""))
            start = raw.get("start")
            end = raw.get("end")
        else:
            text = getattr(raw, "word", getattr(raw, "text", ""))
            start = getattr(raw, "start", None)
            end = getattr(raw, "end", None)
        text = str(text or "").strip()
        try:
            start_value = float(start)
            end_value = float(end)
        except (TypeError, ValueError):
            continue
        if not is_valid_speech_text(text) or not math.isfinite(start_value) or not math.isfinite(end_value):
            continue
        if start_value < 0 or end_value < start_value:
            continue
        words.append({
            "text": text,
            "start": round(start_value, 3),
            "end": round(end_value, 3),
        })
    return words


@lru_cache(maxsize=2)
def _load_mlx_audio_model(model_name: str) -> Any:
    """Load an MLX-Audio model once per server process."""
    from mlx_audio.stt import load

    return load(model_name)


def _normalize_engine_result(
    raw_result: Any, duration_sec: float
) -> tuple[str, List[Dict[str, Any]], str]:
    """Extract text and timestamped segments from an engine result."""
    if isinstance(raw_result, dict):
        full_text = str(raw_result.get("text", "")).strip()
        raw_segments = raw_result.get("segments", []) or []
    else:
        full_text = str(getattr(raw_result, "text", raw_result)).strip()
        raw_segments = getattr(raw_result, "segments", None)
        if raw_segments is None:
            raw_segments = getattr(raw_result, "sentences", None) or []

    normalized: List[Dict[str, Any]] = []
    native_timestamps = bool(raw_segments)
    saw_timestamped_segment = False
    for idx, seg in enumerate(raw_segments):
        if isinstance(seg, dict):
            text = str(seg.get("text", "")).strip()
            start = seg.get("start")
            end = seg.get("end")
        else:
            text = str(getattr(seg, "text", "")).strip()
            start = getattr(seg, "start", None)
            end = getattr(seg, "end", None)
        if not is_valid_speech_text(text):
            continue
        if start is None or end is None:
            native_timestamps = False
        else:
            saw_timestamped_segment = True
        words = _normalize_words(
            seg.get("words") if isinstance(seg, dict) else getattr(seg, "words", None)
        )
        normalized.append(
            {
                "id": idx,
                "start": round(float(start or 0.0), 3),
                "end": round(float(end if end is not None else duration_sec), 3),
                "text": text,
                **({"words": words} if words else {}),
            }
        )

    # A backend without timestamps may still contribute text. Keep the API
    # contract by treating that one result as spanning the whole slice.
    if full_text and not normalized and is_valid_speech_text(full_text):
        normalized = [
            {
                "id": 0,
                "start": 0.0,
                "end": round(float(duration_sec), 3),
                "text": full_text,
            }
        ]
    if not full_text and normalized:
        full_text = " ".join(seg["text"] for seg in normalized)
    if normalized and native_timestamps and saw_timestamped_segment:
        timestamp_source = "native"
    elif full_text:
        timestamp_source = "synthesized-full-window"
    else:
        timestamp_source = "none"
    return full_text, normalized, timestamp_source



def get_asr_status() -> Dict[str, Any]:
    """Return runtime status of the ASR engine."""
    backends = {
        backend: importlib.util.find_spec(module) is not None
        for backend, module in (("mlx_whisper", "mlx_whisper"), ("mlx_audio", "mlx_audio"))
    }
    backend_available = any(backends.values())

    return {
        "available": backend_available,
        "backend": "mlx_whisper" if backends["mlx_whisper"] else "mlx_audio",
        "backends": backends,
        "allowedModels": list(ALLOWED_MODELS),
        "defaultModel": DEFAULT_MODEL_NAME,
        "targetSampleRate": TARGET_SAMPLE_RATE,
        "maxDurationSec": MAX_AUDIO_DURATION_SEC,
        "metalPeakBytes": get_metal_peak_memory_bytes(),
        "processRssBytes": get_process_rss_bytes(),
    }
