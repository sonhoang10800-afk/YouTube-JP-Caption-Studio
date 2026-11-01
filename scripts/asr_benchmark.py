#!/usr/bin/env python3
"""ASR Benchmark harness: Levenshtein CER, RTF, RAM, and Metal evaluation for Japanese captions.

Provides:
1. Corrected Japanese text normalization (preserving Latin letters, katakana prolonged mark ー).
2. Dynamic programming Levenshtein distance, CER, Deletion Rate, and Insertion Rate.
3. Multi-model matrix evaluation and DSP comparison (with/without audio enhancement).
4. Live Apple Silicon Metal memory, cache clearing, and Real-Time Factor (RTF) measurement.
5. Offline benchmark matrix comparing candidate models against baseline YouTube auto-captions.
"""

from __future__ import annotations

import argparse
from collections import Counter
import difflib
import json
import math
import os
import re
import resource
import sys
import time
import unicodedata
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple, Union

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
LOCAL_BRIDGE = ROOT / "local-bridge"
if str(LOCAL_BRIDGE) not in sys.path:
    sys.path.insert(0, str(LOCAL_BRIDGE))

try:
    from app.services.asr import (
        DEFAULT_INITIAL_PROMPT,
        DEFAULT_MODEL_NAME,
        apply_audio_dsp,
    )
except ImportError:
    DEFAULT_MODEL_NAME = "mlx-community/whisper-large-v3-turbo"
    DEFAULT_INITIAL_PROMPT = "こんにちは。日本語のYouTube動画の字幕です。"

    def apply_audio_dsp(audio: np.ndarray, filter_profile: str = "enhanced", sr: int = 16000) -> np.ndarray:  # type: ignore
        return audio


def normalize_ja_text(text: Optional[str]) -> str:
    """Normalize Japanese transcript text for invariant CER calculation.

    Rules:
    1. Unicode NFKC (full-width ASCII/digits -> half-width; half-width kana -> full-width).
    2. Strip bracketed noise/sound tokens: [音楽], (拍手), [ため息], etc.
    3. Explicitly lowercase Latin characters BEFORE regex character filtering.
    4. Remove all whitespace.
    5. Strip punctuation while preserving Japanese kana, kanji, alphanumeric,
       iteration mark 々, and the Katakana prolonged sound mark ー (\\u30FC).
    """
    if not text:
        return ""
    # 1. Unicode NFKC
    text = unicodedata.normalize("NFKC", text)
    # 2. Strip bracketed noise/sound descriptions
    text = re.sub(r"\[.*?\]", "", text)
    text = re.sub(r"\(.*?\)", "", text)
    text = re.sub(r"【.*?】", "", text)
    text = re.sub(r"〔.*?〕", "", text)
    # 3. Explicitly lowercase Latin characters
    text = text.lower()
    # 4. Remove all whitespace
    text = re.sub(r"\s+", "", text)
    # 5. Filter punctuation while preserving kana, kanji, iteration mark 々 (\u3005), alphanumeric, and prolonged mark ー
    text = re.sub(r"[^a-z0-9\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FFF\u30FC\u3005]", "", text)
    return text


def compute_cer_details(ref: str, hyp: str) -> Dict[str, Any]:
    """Calculate Levenshtein distance with breakdown of substitutions, deletions, insertions.

    Metrics:
    - CER = (Substitutions + Deletions + Insertions) / len(ref)
    - Deletion Rate = Deletions / len(ref) (identifies dropped words / quiet whisper omissions)
    - Insertion Rate = Insertions / len(ref) (identifies hallucination on noise/BGM)
    """
    n_ref = len(ref)
    n_hyp = len(hyp)
    if n_ref == 0 and n_hyp == 0:
        return {
            "cer": 0.0,
            "substitutions": 0,
            "deletions": 0,
            "insertions": 0,
            "deletionRate": 0.0,
            "insertionRate": 0.0,
        }
    if n_ref == 0:
        return {
            "cer": 1.0,
            "substitutions": 0,
            "deletions": 0,
            "insertions": n_hyp,
            "deletionRate": 0.0,
            "insertionRate": 1.0,
        }
    if n_hyp == 0:
        return {
            "cer": 1.0,
            "substitutions": 0,
            "deletions": n_ref,
            "insertions": 0,
            "deletionRate": 1.0,
            "insertionRate": 0.0,
        }

    dp = np.zeros((n_ref + 1, n_hyp + 1), dtype=np.int32)
    for i in range(n_ref + 1):
        dp[i, 0] = i
    for j in range(n_hyp + 1):
        dp[0, j] = j

    for i in range(1, n_ref + 1):
        for j in range(1, n_hyp + 1):
            cost = 0 if ref[i - 1] == hyp[j - 1] else 1
            dp[i, j] = min(
                dp[i - 1, j] + 1,        # deletion
                dp[i, j - 1] + 1,        # insertion
                dp[i - 1, j - 1] + cost  # substitution / match
            )

    i, j = n_ref, n_hyp
    subs, dels, inss = 0, 0, 0
    while i > 0 or j > 0:
        if i > 0 and j > 0 and dp[i, j] == dp[i - 1, j - 1] + (0 if ref[i - 1] == hyp[j - 1] else 1):
            if ref[i - 1] != hyp[j - 1]:
                subs += 1
            i -= 1
            j -= 1
        elif i > 0 and dp[i, j] == dp[i - 1, j] + 1:
            dels += 1
            i -= 1
        else:
            inss += 1
            j -= 1

    total_err = subs + dels + inss
    cer = total_err / n_ref
    del_rate = dels / n_ref
    ins_rate = inss / n_ref
    return {
        "cer": round(float(cer), 4),
        "substitutions": subs,
        "deletions": dels,
        "insertions": inss,
        "deletionRate": round(float(del_rate), 4),
        "insertionRate": round(float(ins_rate), 4),
    }


def compute_cer(ref: str, hyp: str) -> float:
    """Compute raw Character Error Rate."""
    return compute_cer_details(ref, hyp)["cer"]


def compute_normalized_cer(ref: str, hyp: str) -> float:
    """Compute Character Error Rate on normalized Japanese text."""
    norm_ref = normalize_ja_text(ref)
    norm_hyp = normalize_ja_text(hyp)
    return compute_cer_details(norm_ref, norm_hyp)["cer"]


MIN_VERIFIED_REF_CHARS = 2400
MIN_STRESS_REF_CHARS = 1200
MIN_STRESS_GROUP_REF_CHARS = 120
STRESS_REQUIRED_GROUPS = (
    "bgm",
    "outro",
    "noise",
    "quiet",
    "dialect",
    "homophone",
    "multi_speaker",
)
CER_PASS_THRESHOLD = 0.05
STRESS_MARGIN = 0.02
AGENT_REVIEW_KIND = "agent-official-crosscheck"
_YOUTUBE_HOST_RE = re.compile(r"^(?:https?://)?(?:www\.)?(?:youtube\.com|youtu\.be)/", re.IGNORECASE)
_SHA256_RE = re.compile(r"^[0-9a-f]{64}$", re.IGNORECASE)


def is_window_verified(window: Dict[str, Any]) -> bool:
    """Return True only for a fully reviewed ground-truth window.

    A bare boolean cannot prove that anybody checked the audio. The gate also
    requires an independent source outside YouTube, a named reviewer, a review
    date, and the SHA-256 of the exact WAV used for the run.
    """
    source = str(window.get("verificationSource") or "").strip()
    reviewer = str(window.get("reviewedBy") or "").strip()
    reviewed_at = str(window.get("reviewedAt") or "").strip()
    digest = str(window.get("audioSha256") or "").strip()
    review_kind = str(window.get("reviewKind") or "").strip()
    return bool(
        window.get("audioVerified") is True
        and source
        and not _YOUTUBE_HOST_RE.match(source)
        and reviewer.startswith("agent:")
        and review_kind == AGENT_REVIEW_KIND
        and reviewed_at
        and _SHA256_RE.fullmatch(digest)
    )


def stitch_transcripts(texts: List[str]) -> str:
    """Join overlapping slice hypotheses without duplicating the shared speech.

    Exact suffix/prefix matching misses ordinary ASR drift (one kana, a numeral
    width difference, a filler word). Compare only the bounded tail/head region
    and cut at the highest-scoring fuzzy overlap. The result is normalized so
    CER compares speech characters rather than punctuation or spacing.
    """
    out = ""
    for raw in texts:
        text = normalize_ja_text(raw)
        if not text:
            continue
        if not out:
            out = text
            continue

        max_len = min(len(out), len(text))
        min_len = 4 if max_len >= 4 else 1
        best_size = 0
        best_score = 0.0
        # The production overlap is 1.5 s. A generous character window covers a
        # fast Japanese speaker while staying bounded for long windows.
        limit = min(max_len, max(24, max_len // 3))
        for size in range(min_len, limit + 1):
            left = out[-size:]
            right = text[:size]
            ratio = difflib.SequenceMatcher(None, left, right, autojunk=False).ratio()
            score = ratio * size
            if ratio >= 0.60 and score > best_score:
                best_size = size
                best_score = score
        out += text[best_size:]
    return out


def _prediction_text(prediction: Any) -> str:
    """Return hypothesis text from either the raw or structured prediction form."""
    if isinstance(prediction, dict):
        return str(prediction.get("text", ""))
    return str(prediction or "")


def _segments_text_after_seconds(
    prediction: Any, min_seconds: float, previous_text: str
) -> Optional[str]:
    """Return normalized segment text after a known overlap boundary.

    ASR engines return segment times relative to the submitted window. Segments
    wholly inside the overlap can be skipped. A segment that straddles the
    boundary has no word-level timing, so its text is merged with the previous
    output instead of assuming characters are uniformly distributed in time.
    """
    if not isinstance(prediction, dict):
        return None
    segments = prediction.get("segments")
    if not isinstance(segments, list) or not segments:
        return None

    pieces: List[str] = []
    for segment in segments:
        if not isinstance(segment, dict):
            return None
        try:
            start = float(segment.get("start"))
            end = float(segment.get("end"))
        except (TypeError, ValueError):
            return None
        text = normalize_ja_text(segment.get("text", ""))
        if not text or end <= min_seconds:
            continue
        if start >= min_seconds:
            pieces.append(text)
            continue
        merged = stitch_transcripts([previous_text, text])
        pieces.append(merged[len(previous_text):])
    return "".join(pieces)


def stitch_predictions(
    predictions: Sequence[Any], windows: Sequence[Dict[str, Any]]
) -> str:
    """Stitch overlapping window predictions using known time boundaries.

    Falls back to the text-only fuzzy stitcher when an engine has no segments.
    """
    out = ""
    previous_end_ms: Optional[int] = None
    for prediction, window in zip(predictions, windows):
        text = normalize_ja_text(_prediction_text(prediction))
        if not text:
            continue
        start_ms = int(window.get("startMs", 0))
        end_ms = int(window.get("endMs", start_ms))
        overlap_seconds = 0.0
        if previous_end_ms is not None and start_ms < previous_end_ms:
            overlap_seconds = (previous_end_ms - start_ms) / 1000.0
        if overlap_seconds <= 0:
            out += text
        else:
            segmented = _segments_text_after_seconds(prediction, overlap_seconds, out)
            if segmented is None:
                out = stitch_transcripts([out, text])
            else:
                out += segmented
        previous_end_ms = max(end_ms, previous_end_ms or end_ms)
    return out


def _group_stream_windows(
    windows: List[Dict[str, Any]], include_unverified: bool
) -> List[Dict[str, Any]]:
    """Group reviewed, time-adjacent windows into unique-reference streams."""
    selected = [
        window
        for window in windows
        if include_unverified or is_window_verified(window)
    ]
    selected.sort(
        key=lambda window: (
            str(window.get("videoId") or ""),
            int(window.get("startMs", 0)),
            int(window.get("endMs", window.get("startMs", 0))),
        )
    )

    streams: List[Dict[str, Any]] = []
    current: Optional[Dict[str, Any]] = None
    previous_end_ms: Optional[int] = None

    def flush() -> None:
        nonlocal current, previous_end_ms
        if current is None:
            return
        current["reference"] = "".join(current.pop("_reference_parts"))
        current["categoryRefChars"] = dict(sorted(current["categoryRefChars"].items()))
        streams.append(current)
        current = None
        previous_end_ms = None

    for window in selected:
        video_id = str(window.get("videoId") or window["id"])
        start_ms = int(window.get("startMs", 0))
        end_ms = int(window.get("endMs", start_ms))
        if (
            current is None
            or current["videoId"] != video_id
            or previous_end_ms is None
            or start_ms >= previous_end_ms
        ):
            flush()
            current = {
                "videoId": video_id,
                "windowIds": [],
                "startMs": start_ms,
                "endMs": end_ms,
                "categoryRefChars": Counter(),
                "_reference_parts": [],
            }

        if "streamReference" in window:
            reference_part = normalize_ja_text(window.get("streamReference"))
        elif previous_end_ms is not None and start_ms < previous_end_ms:
            raise ValueError(
                f"window {window['id']} overlaps its predecessor but has no streamReference"
            )
        else:
            reference_part = normalize_ja_text(window.get("referenceHypothesis"))

        current["windowIds"].append(window["id"])
        current["endMs"] = max(int(current["endMs"]), end_ms)
        current["_reference_parts"].append(reference_part)
        category = str(window.get("errorCategory") or window.get("category") or "unknown")
        current["categoryRefChars"][category] += len(reference_part)
        previous_end_ms = max(end_ms, previous_end_ms or end_ms)

    flush()
    return streams


def _evaluate_streaming_windows(
    manifest_path: Path,
    data: Dict[str, Any],
    predictions: Dict[str, Dict[str, Any]],
    *,
    include_unverified: bool,
    min_ref_chars: int,
) -> Dict[str, Any]:
    """Evaluate stitched transcription streams without double-counting overlap."""
    windows = data.get("windows", [])
    streams = _group_stream_windows(windows, include_unverified)
    gate_window_ids = {window_id for stream in streams for window_id in stream["windowIds"]}
    verified_ids = {
        window["id"] for window in windows if is_window_verified(window)
    }
    model_keys = sorted({
        model_key
        for window_predictions in predictions.values()
        for model_key in window_predictions
    })

    stream_outputs: List[Dict[str, Any]] = []
    baseline_records: List[Dict[str, Any]] = []
    baseline_raw_cers: List[float] = []
    baseline_norm_cers: List[float] = []
    baseline_deletions: List[float] = []
    baseline_insertions: List[float] = []
    baseline_repetitions: List[float] = []
    baseline_windows_with_insertions = 0
    baseline_category_refs: Counter[str] = Counter()
    all_category_refs: Counter[str] = Counter()

    window_lookup = {window["id"]: window for window in windows}
    for stream_index, stream in enumerate(streams, start=1):
        source_texts = [
            window_lookup[window_id].get("sourceAsr", "")
            for window_id in stream["windowIds"]
        ]
        source_hypothesis = stitch_transcripts(source_texts)
        raw_details = compute_cer_details(
            "".join(window_lookup[window_id].get("referenceHypothesis", "") for window_id in stream["windowIds"]),
            "".join(source_texts),
        )
        norm_details = compute_cer_details(stream["reference"], source_hypothesis)
        repetition = repetition_metrics(source_hypothesis)
        baseline_records.append({
            **norm_details,
            "refChars": len(stream["reference"]),
            "clusterKey": stream["videoId"],
            "windowId": f"stream-{stream_index:03d}",
        })
        baseline_raw_cers.append(raw_details["cer"])
        baseline_norm_cers.append(norm_details["cer"])
        baseline_deletions.append(norm_details["deletionRate"])
        baseline_insertions.append(norm_details["insertionRate"])
        baseline_repetitions.append(repetition["repeatedNgramExcessRate"])
        if norm_details["insertions"] > 0:
            baseline_windows_with_insertions += 1
        for category, char_count in stream["categoryRefChars"].items():
            baseline_category_refs[category] += char_count
            all_category_refs[category] += char_count

        stream_outputs.append({
            "id": f"stream-{stream_index:03d}",
            "videoId": stream["videoId"],
            "windowIds": list(stream["windowIds"]),
            "startMs": stream["startMs"],
            "endMs": stream["endMs"],
            "reference": stream["reference"],
            "sourceAsr": source_hypothesis,
            "categoryRefChars": stream["categoryRefChars"],
            "hypotheses": {},
        })

    baseline = summarize_cer_errors(baseline_records, min_ref_chars=min_ref_chars)
    baseline.update({
        "evaluatedWindows": len(gate_window_ids),
        "evaluatedStreams": len(streams),
        "meanRawCer": round(float(np.mean(baseline_raw_cers)), 4) if baseline_raw_cers else None,
        "meanNormCer": round(float(np.mean(baseline_norm_cers)), 4) if baseline_norm_cers else None,
        "meanDeletionRate": round(float(np.mean(baseline_deletions)), 4) if baseline_deletions else None,
        "meanInsertionRate": round(float(np.mean(baseline_insertions)), 4) if baseline_insertions else None,
        "meanRepetitionExcessRate": round(float(np.mean(baseline_repetitions)), 6) if baseline_repetitions else None,
        "windowsWithInsertions": baseline_windows_with_insertions,
        "categoryRefChars": dict(sorted(baseline_category_refs.items())),
    })

    model_summaries: Dict[str, Any] = {}
    for model_key in model_keys:
        stream_records: List[Dict[str, Any]] = []
        raw_cers: List[float] = []
        norm_cers: List[float] = []
        deletion_rates: List[float] = []
        insertion_rates: List[float] = []
        repetition_rates: List[float] = []
        category_refs: Counter[str] = Counter()
        contributing_window_ids = set()
        windows_with_insertions = 0

        for stream, stream_output in zip(streams, stream_outputs):
            entries = [
                predictions.get(window_id, {}).get(model_key)
                for window_id in stream["windowIds"]
            ]
            if not any(entry is not None for entry in entries):
                continue
            window_entries = [window_lookup[window_id] for window_id in stream["windowIds"]]
            texts = [
                entry.get("text", "") if isinstance(entry, dict) else str(entry or "")
                for entry in entries
            ]
            hypothesis = stitch_predictions(entries, window_entries)
            stream_output["hypotheses"][model_key] = hypothesis
            raw_reference = "".join(
                window_lookup[window_id].get("referenceHypothesis", "")
                for window_id in stream["windowIds"]
            )
            raw_details = compute_cer_details(raw_reference, "".join(texts))
            norm_details = compute_cer_details(stream["reference"], hypothesis)
            repetition = repetition_metrics(hypothesis)
            stream_records.append({
                **norm_details,
                "refChars": len(stream["reference"]),
                "clusterKey": stream["videoId"],
                "windowId": stream_output["id"],
            })
            raw_cers.append(raw_details["cer"])
            norm_cers.append(norm_details["cer"])
            deletion_rates.append(norm_details["deletionRate"])
            insertion_rates.append(norm_details["insertionRate"])
            repetition_rates.append(repetition["repeatedNgramExcessRate"])
            if norm_details["insertions"] > 0:
                windows_with_insertions += 1
            for category, char_count in stream["categoryRefChars"].items():
                category_refs[category] += char_count
            for window_id, entry in zip(stream["windowIds"], entries):
                if entry is not None:
                    contributing_window_ids.add(window_id)

        rtfs: List[float] = []
        backends = set()
        http_statuses: Counter[str] = Counter()
        cold_start_requests = 0
        transport_error_windows = 0
        contract_error_windows = 0
        http_error_windows = 0
        native_timestamp_windows = 0
        rss_values: List[int] = []
        metal_values: List[int] = []
        for window_id in gate_window_ids:
            entry = predictions.get(window_id, {}).get(model_key)
            if not isinstance(entry, dict):
                continue
            if entry.get("rtf") is not None:
                rtfs.append(entry["rtf"])
            if entry.get("timestampSource") == "native":
                native_timestamp_windows += 1
            if entry.get("backend"):
                backends.add(str(entry["backend"]))
            if entry.get("httpStatus") is not None:
                http_statuses[str(entry["httpStatus"])] += 1
                if entry["httpStatus"] != 200:
                    http_error_windows += 1
            else:
                transport_error_windows += 1
            if entry.get("contractError"):
                contract_error_windows += 1
            if entry.get("coldStart"):
                cold_start_requests += 1
            if isinstance(entry.get("rssBytes"), (int, float)):
                rss_values.append(int(entry["rssBytes"]))
            if isinstance(entry.get("metalPeakBytes"), (int, float)):
                metal_values.append(int(entry["metalPeakBytes"]))

        error_summary = summarize_cer_errors(stream_records, min_ref_chars=min_ref_chars)
        evaluated_windows = len(contributing_window_ids)
        model_summaries[model_key] = {
            **error_summary,
            "evaluatedWindows": evaluated_windows,
            "evaluatedStreams": len(stream_records),
            "meanRawCer": round(float(np.mean(raw_cers)), 4) if raw_cers else 0.0,
            "meanNormCer": round(float(np.mean(norm_cers)), 4) if norm_cers else 0.0,
            "meanDeletionRate": round(float(np.mean(deletion_rates)), 4) if deletion_rates else 0.0,
            "meanInsertionRate": round(float(np.mean(insertion_rates)), 4) if insertion_rates else 0.0,
            "meanRepetitionExcessRate": round(float(np.mean(repetition_rates)), 6) if repetition_rates else 0.0,
            "windowsWithInsertions": windows_with_insertions,
            "meanRtf": round(float(np.mean(rtfs)), 4) if rtfs else 0.0,
            "backends": sorted(backends),
            "httpStatuses": dict(sorted(http_statuses.items())),
            "transportErrorWindows": transport_error_windows,
            "httpErrorWindows": http_error_windows,
            "contractErrorWindows": contract_error_windows,
            "coldStartRequests": cold_start_requests,
            "nativeTimestampWindows": native_timestamp_windows,
            "timestampCoverage": round(native_timestamp_windows / evaluated_windows, 6) if evaluated_windows else 0.0,
            "timestampsUsable": bool(evaluated_windows and native_timestamp_windows == evaluated_windows),
            "maxRssBytes": max(rss_values) if rss_values else None,
            "maxMetalPeakBytes": max(metal_values) if metal_values else None,
            "categoryRefChars": dict(sorted(category_refs.items())),
        }

    window_rows = []
    for window in windows:
        row = {
            "id": window["id"],
            "videoId": window.get("videoId"),
            "startMs": window.get("startMs"),
            "endMs": window.get("endMs"),
            "category": window.get("errorCategory") or window.get("category"),
            "audioVerified": window["id"] in verified_ids,
            "referenceHypothesis": window.get("referenceHypothesis", ""),
            "streamReference": window.get("streamReference"),
            "sourceAsr": window.get("sourceAsr", ""),
        }
        window_predictions = predictions.get(window["id"], {})
        if window_predictions:
            row["models"] = {
                model_key: {"hyp": _prediction_text(entry)}
                for model_key, entry in window_predictions.items()
            }
        window_rows.append(row)

    return {
        "manifest": str(manifest_path),
        "streaming": True,
        "totalWindows": len(windows),
        "verifiedWindows": len(verified_ids),
        "unverifiedWindows": len(windows) - len(verified_ids),
        "gateWindows": len(gate_window_ids),
        "includeUnverified": include_unverified,
        "diagnosticOnly": include_unverified or len(verified_ids) < len(windows),
        "evaluatedStreams": len(streams),
        "baselineYouTube": baseline,
        "modelEvaluations": model_summaries,
        "streams": stream_outputs,
        "windows": window_rows,
    }


def wilson_interval(errors: int, total: int, z: float = 1.96) -> Optional[Tuple[float, float]]:
    """Return the bounded 95% interval for an error rate capped at 100%.

    Insertions can make CER exceed one even though it is an edit count over
    reference characters. Wilson's binomial formula is undefined above one;
    cap the rate for the interval while callers retain the raw CER separately.
    """
    if total <= 0:
        return None
    observed = min(errors / total, 1.0)
    denominator = 1.0 + (z * z / total)
    center = (observed + (z * z / (2.0 * total))) / denominator
    radius = z * math.sqrt(
        (observed * (1.0 - observed) / total) + (z * z / (4.0 * total * total))
    ) / denominator
    return max(0.0, center - radius), min(1.0, center + radius)


def repetition_metrics(text: str, ngram_size: int = 6) -> Dict[str, Any]:
    """Measure excess repeated n-grams as a proxy for ASR loop hallucinations."""
    normalized = normalize_ja_text(text)
    if len(normalized) < ngram_size:
        return {
            "normalizedChars": len(normalized),
            "ngramSize": ngram_size,
            "repeatedNgramExcess": 0,
            "repeatedNgramExcessRate": 0.0,
        }
    ngrams = [normalized[i:i + ngram_size] for i in range(len(normalized) - ngram_size + 1)]
    excess = sum(count - 1 for count in Counter(ngrams).values() if count > 1)
    return {
        "normalizedChars": len(normalized),
        "ngramSize": ngram_size,
        "repeatedNgramExcess": excess,
        "repeatedNgramExcessRate": round(excess / len(ngrams), 6),
    }


def _cluster_bootstrap_cer(
    errors: List[Dict[str, Any]], iterations: int, seed: int
) -> Optional[Tuple[float, float]]:
    """Bootstrap CER by resampling video-level clusters, not individual windows."""
    if iterations <= 0 or not errors:
        return None
    groups: Dict[str, List[Dict[str, Any]]] = {}
    for index, error in enumerate(errors):
        key = str(error.get("clusterKey") or error.get("windowId") or index)
        groups.setdefault(key, []).append(error)
    if len(groups) < 2:
        return None

    clustered = list(groups.values())
    rng = np.random.default_rng(seed)
    samples: List[float] = []
    for _ in range(iterations):
        picked = rng.integers(0, len(clustered), size=len(clustered))
        ref_total = 0
        error_total = 0
        for index in picked:
            for record in clustered[int(index)]:
                ref_total += int(record.get("refChars", 0))
                error_total += (
                    int(record.get("substitutions", 0))
                    + int(record.get("deletions", 0))
                    + int(record.get("insertions", 0))
                )
        if ref_total:
            samples.append(error_total / ref_total)
    if not samples:
        return None
    low, high = np.quantile(np.asarray(samples, dtype=np.float64), [0.025, 0.975])
    return round(float(low), 8), round(float(high), 8)


def summarize_cer_errors(
    errors: List[Dict[str, Any]],
    min_ref_chars: int = MIN_VERIFIED_REF_CHARS,
    pass_threshold: float = CER_PASS_THRESHOLD,
    bootstrap_iterations: int = 2000,
    bootstrap_seed: int = 42,
) -> Dict[str, Any]:
    """Aggregate per-window error counts into total-character CER.

    Averaging per-window CER overweights short windows and cannot enforce a
    corpus-level error budget. Counts are therefore summed before dividing.
    """
    total_ref = sum(int(e["refChars"]) for e in errors)
    total_sub = sum(int(e["substitutions"]) for e in errors)
    total_del = sum(int(e["deletions"]) for e in errors)
    total_ins = sum(int(e["insertions"]) for e in errors)
    total_err = total_sub + total_del + total_ins
    cer = (total_err / total_ref) if total_ref else None

    if total_ref < min_ref_chars:
        verdict = "NOT_PROVEN"
    elif cer is not None and cer <= pass_threshold:
        verdict = "PASS"
    else:
        verdict = "FAIL"

    result = {
        "evaluatedWindows": len(errors),
        "totalRefChars": total_ref,
        "totalErrors": total_err,
        "substitutions": total_sub,
        "deletions": total_del,
        "insertions": total_ins,
        "normCer": round(float(cer), 8) if cer is not None else None,
        "deletionRate": round(total_del / total_ref, 8) if total_ref else None,
        "insertionRate": round(total_ins / total_ref, 8) if total_ref else None,
        "thresholdMet": total_ref >= min_ref_chars and cer is not None and cer <= pass_threshold,
        "verdict": verdict,
    }
    result["wilson95"] = wilson_interval(total_err, total_ref)
    result["clusterBootstrap95"] = _cluster_bootstrap_cer(
        errors, iterations=bootstrap_iterations, seed=bootstrap_seed
    )
    result["bootstrapIterations"] = bootstrap_iterations
    result["bootstrapSeed"] = bootstrap_seed
    result["clusterCount"] = len({
        str(e.get("clusterKey") or e.get("windowId") or index)
        for index, e in enumerate(errors)
    })
    return result


def summarize_cer_errors_with_clusters(
    errors: List[Dict[str, Any]], iterations: int = 2000, seed: int = 42
) -> Dict[str, Any]:
    """Compatibility wrapper used by the benchmark CLI for reproducible CIs."""
    return summarize_cer_errors(
        errors,
        bootstrap_iterations=iterations,
        bootstrap_seed=seed,
    )


def summarize_stress_gate(
    clean: Dict[str, Any],
    stress: Dict[str, Any],
    margin: float = STRESS_MARGIN,
) -> Dict[str, Any]:
    """Apply the agreed degradation gate to aggregate stress CER."""
    clean_cer = clean.get("normCer")
    stress_cer = stress.get("normCer")
    category_ref_chars = stress.get("categoryRefChars") or {}
    insufficient_groups = [
        group
        for group in STRESS_REQUIRED_GROUPS
        if int(category_ref_chars.get(group, 0) or 0) < MIN_STRESS_GROUP_REF_CHARS
    ]
    if (
        stress.get("totalRefChars", 0) < MIN_STRESS_REF_CHARS
        or insufficient_groups
        or clean_cer is None
        or stress_cer is None
    ):
        verdict = "NOT_PROVEN"
        max_allowed = None
    else:
        max_allowed = float(clean_cer) + margin
        verdict = "PASS" if float(stress_cer) <= max_allowed else "FAIL"
    return {
        "cleanCer": clean_cer,
        "stressCer": stress_cer,
        "maxAllowedCer": max_allowed,
        "margin": margin,
        "totalRefChars": stress.get("totalRefChars", 0),
        "requiredGroups": list(STRESS_REQUIRED_GROUPS),
        "minimumGroupRefChars": MIN_STRESS_GROUP_REF_CHARS,
        "categoryRefChars": category_ref_chars,
        "insufficientGroups": insufficient_groups,
        "thresholdMet": verdict == "PASS",
        "verdict": verdict,
    }


_CONFIG_KEY_RE = re.compile(
    r"^(?P<model>.+) \[dsp_(?P<dsp>on|off)"
    r"(?:,cond_(?P<condition>false|true),prompt_(?P<prompt>[a-z][a-z-]*))?\]$"
)


def _dsp_pair_keys(config_key: str) -> Optional[tuple[str, str]]:
    """Return the matching DSP-on/off keys for one model decode configuration."""
    match = _CONFIG_KEY_RE.fullmatch(config_key)
    if not match:
        return None
    suffix = ""
    if match.group("condition") is not None:
        suffix = f",cond_{match.group('condition')},prompt_{match.group('prompt')}"
    model = match.group("model")
    return (
        f"{model} [dsp_on{suffix}]",
        f"{model} [dsp_off{suffix}]",
    )


def select_model_and_dsp(
    clean_summary: Dict[str, Any], stress_summary: Dict[str, Any]
) -> Dict[str, Any]:
    """Choose the default model using the frozen clean/stress/RTF ordering."""
    clean_models = clean_summary.get("modelEvaluations", {})
    stress_models = stress_summary.get("modelEvaluations", {})
    candidates: List[Dict[str, Any]] = []
    eligible: List[Dict[str, Any]] = []
    corpus_unreviewed = bool(
        clean_summary.get("diagnosticOnly") or stress_summary.get("diagnosticOnly")
    )
    denominators_incomplete = corpus_unreviewed

    for config_key, clean_result in sorted(clean_models.items()):
        match = _CONFIG_KEY_RE.fullmatch(config_key)
        model, dsp = (match.group("model"), match.group("dsp")) if match else (config_key, "unknown")
        dsp_pair = _dsp_pair_keys(config_key)
        condition_on_previous_text = (
            match.group("condition") == "true"
            if match and match.group("condition") is not None
            else None
        )
        initial_prompt_mode = match.group("prompt") if match else None
        stress_result = stress_models.get(config_key)
        reason = None
        stress_gate = None
        dsp_reason = None
        if dsp_pair:
            dsp_on_key, dsp_off_key = dsp_pair
            dsp_on_clean = clean_models.get(dsp_on_key)
            dsp_off_clean = clean_models.get(dsp_off_key)
            dsp_on_stress = stress_models.get(dsp_on_key)
            dsp_off_stress = stress_models.get(dsp_off_key)
            if any(result is None for result in (dsp_on_clean, dsp_off_clean, dsp_on_stress, dsp_off_stress)):
                dsp_reason = "DSP-on/DSP-off pair is incomplete"
            elif (
                float(dsp_on_clean.get("normCer", 1.0)) > float(dsp_off_clean.get("normCer", 1.0))
                or float(dsp_on_stress.get("normCer", 1.0)) > float(dsp_off_stress.get("normCer", 1.0))
            ):
                dsp_reason = "DSP-on CER is worse than DSP-off"

        if corpus_unreviewed:
            reason = "clean or stress corpus contains unreviewed windows"
        elif clean_result.get("totalRefChars", 0) < MIN_VERIFIED_REF_CHARS:
            denominators_incomplete = True
            reason = "clean denominator below 2400 characters"
        elif not stress_result or stress_result.get("totalRefChars", 0) < MIN_STRESS_REF_CHARS:
            denominators_incomplete = True
            reason = "stress denominator below 1200 characters"
        elif not clean_result.get("timestampsUsable") or not stress_result.get("timestampsUsable"):
            reason = "model lacks native timestamps on every window"
        elif dsp_reason:
            reason = dsp_reason
        elif clean_result.get("cleanCer", clean_result.get("normCer", 1.0)) > CER_PASS_THRESHOLD:
            reason = "clean CER is above 5%"
        else:
            stress_gate = summarize_stress_gate(clean_result, stress_result)
            evaluated = int(clean_result.get("evaluatedWindows", 0) or 0)
            http_count = sum(int(value) for value in clean_result.get("httpStatuses", {}).values())
            if clean_result.get("transportErrorWindows", 0) or stress_result.get("transportErrorWindows", 0):
                reason = "transport errors occurred"
            elif clean_result.get("contractErrorWindows", 0) or stress_result.get("contractErrorWindows", 0):
                reason = "HTTP contract errors occurred"
            elif http_count and http_count != evaluated:
                reason = "not every clean request returned HTTP 200"
            elif not clean_result.get("meanRtf"):
                reason = "RTF was not measured"
            elif stress_gate["verdict"] != "PASS":
                reason = "stress CER exceeded clean CER + 2 percentage points"

        candidate = {
            "configKey": config_key,
            "model": model,
            "dsp": dsp,
            "conditionOnPreviousText": condition_on_previous_text,
            "initialPromptMode": initial_prompt_mode,
            "cleanCer": clean_result.get("normCer"),
            "stressCer": stress_result.get("normCer") if stress_result else None,
            "cleanRefChars": clean_result.get("totalRefChars"),
            "stressRefChars": stress_result.get("totalRefChars") if stress_result else None,
            "meanRtf": clean_result.get("meanRtf"),
            "timestampsUsable": bool(clean_result.get("timestampsUsable")),
            "stressGate": stress_gate,
            "eligible": reason is None,
            "reason": reason,
        }
        candidates.append(candidate)
        if reason is None:
            eligible.append(candidate)

    winner = min(
        eligible,
        key=lambda item: (
            float(item["cleanCer"]),
            float(item["stressCer"]),
            float(item["meanRtf"]),
        ),
        default=None,
    )
    if winner:
        verdict = "PASS"
    elif denominators_incomplete:
        verdict = "NOT_PROVEN"
    else:
        verdict = "FAIL"
    return {
        "verdict": verdict,
        "winner": winner,
        "candidates": candidates,
        "selectionRule": "lowest clean CER, then stress CER, then RTF",
    }


def get_process_rss_bytes() -> int:
    """Get the peak resident set size (RSS) in bytes for the current process."""
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
    except Exception:
        pass
    return None


def clear_metal_cache() -> None:
    """Clear Apple Silicon Metal GPU cache to prevent memory bloat between model runs."""
    try:
        import mlx.core as mx
        if hasattr(mx, "clear_cache"):
            mx.clear_cache()
        if hasattr(mx, "metal") and hasattr(mx.metal, "clear_cache"):
            mx.metal.clear_cache()
    except Exception:
        pass


def transcribe_audio_segment(
    audio: np.ndarray,
    model_name: str = DEFAULT_MODEL_NAME,
    sr: int = 16000,
    preprocess: bool = True,
    condition_on_previous_text: bool = False,
    no_speech_threshold: float = 0.85,
    logprob_threshold: float = -1.5,
    initial_prompt: Optional[str] = DEFAULT_INITIAL_PROMPT,
) -> Dict[str, Any]:
    """Transcribe 16 kHz mono audio using MLX Whisper, recording inference time, RTF, and RAM."""
    import mlx_whisper

    if preprocess:
        audio = apply_audio_dsp(audio, filter_profile="enhanced", sr=sr)

    duration_sec = len(audio) / sr
    rss_before = get_process_rss_bytes()

    start_time = time.perf_counter()
    result = mlx_whisper.transcribe(
        audio,
        path_or_hf_repo=model_name,
        language="ja",
        temperature=0.0,
        condition_on_previous_text=condition_on_previous_text,
        no_speech_threshold=no_speech_threshold,
        logprob_threshold=logprob_threshold,
        initial_prompt=initial_prompt,
    )
    elapsed_time = time.perf_counter() - start_time

    rss_after = get_process_rss_bytes()
    metal_peak = get_metal_peak_memory_bytes()

    text = result.get("text", "").strip() if isinstance(result, dict) else str(result).strip()
    rtf = elapsed_time / duration_sec if duration_sec > 0 else 0.0

    return {
        "text": text,
        "elapsedSec": round(elapsed_time, 4),
        "durationSec": round(duration_sec, 4),
        "rtf": round(rtf, 4),
        "rssBytes": max(rss_before, rss_after),
        "metalPeakBytes": metal_peak,
    }


def evaluate_windows(
    manifest_path: str | Path,
    predictions: Optional[Dict[str, Any]] = None,
    include_unverified: bool = False,
    min_ref_chars: int = MIN_VERIFIED_REF_CHARS,
    streaming: bool = False,
) -> Dict[str, Any]:
    """Evaluate baseline ASR and model predictions against reference hypotheses.

    The acceptance gate uses reviewed windows only. ``include_unverified`` is
    available for explicitly labelled diagnostics, never for a PASS verdict.
    In ``streaming`` mode, overlapping window hypotheses are stitched and the
    reference uses each manifest's ``streamReference`` exactly once.
    """
    mpath = Path(manifest_path)
    if not mpath.is_file():
        raise FileNotFoundError(f"Manifest not found: {mpath}")

    with open(mpath, "r", encoding="utf-8") as f:
        data = json.load(f)

    windows = data.get("windows", [])
    if not windows:
        raise ValueError(f"No windows in manifest: {mpath}")

    # Normalize predictions mapping: support both flat Dict[str, str] and Dict[str, Dict[str, Any]]
    norm_preds: Dict[str, Dict[str, Any]] = {}
    if predictions:
        for wid, entry in predictions.items():
            if isinstance(entry, dict):
                # If entry already maps model_name -> result dict
                has_subdicts = any(isinstance(v, (dict, str)) for v in entry.values())
                if has_subdicts and ("text" not in entry or any(isinstance(v, dict) for v in entry.values())):
                    norm_preds[wid] = entry
                else:
                    norm_preds[wid] = {"default": entry}
            elif isinstance(entry, str):
                norm_preds[wid] = {"default": {"text": entry}}

    if streaming:
        return _evaluate_streaming_windows(
            mpath,
            data,
            norm_preds,
            include_unverified=include_unverified,
            min_ref_chars=min_ref_chars,
        )

    results: List[Dict[str, Any]] = []
    yt_norm_errors: List[Dict[str, Any]] = []
    yt_raw_cers: List[float] = []
    yt_norm_cers: List[float] = []
    yt_del_rates: List[float] = []
    yt_ins_rates: List[float] = []
    yt_repetition_rates: List[float] = []
    yt_windows_with_insertions = 0
    verified_count = 0

    for w in windows:
        wid = w["id"]
        ref = w.get("referenceHypothesis", "")
        yt_asr = w.get("sourceAsr", "")
        verified = is_window_verified(w)
        counts_for_gate = verified or include_unverified
        if verified:
            verified_count += 1

        yt_raw_details = compute_cer_details(ref, yt_asr)
        norm_ref = normalize_ja_text(ref)
        yt_norm_details = compute_cer_details(norm_ref, normalize_ja_text(yt_asr))
        yt_quality = repetition_metrics(yt_asr)
        cluster_key = str(w.get("videoId") or wid)
        if counts_for_gate:
            yt_norm_errors.append({
                **yt_norm_details,
                "refChars": len(norm_ref),
                "clusterKey": cluster_key,
                "windowId": wid,
            })
            yt_raw_cers.append(yt_raw_details["cer"])
            yt_norm_cers.append(yt_norm_details["cer"])
            yt_del_rates.append(yt_norm_details["deletionRate"])
            yt_ins_rates.append(yt_norm_details["insertionRate"])
            yt_repetition_rates.append(yt_quality["repeatedNgramExcessRate"])
            if yt_norm_details["insertions"] > 0:
                yt_windows_with_insertions += 1

        row: Dict[str, Any] = {
            "id": wid,
            "videoId": w.get("videoId"),
            "category": w.get("errorCategory") or w.get("category"),
            "audioVerified": verified,
            "ref": ref,
            "normRef": norm_ref,
            "ytAsr": yt_asr,
            "ytNormAsr": normalize_ja_text(yt_asr),
            "ytRawCer": yt_raw_details["cer"],
            "ytNormCer": yt_norm_details["cer"],
            "ytDeletionRate": yt_norm_details["deletionRate"],
            "ytInsertionRate": yt_norm_details["insertionRate"],
        }

        if wid in norm_preds:
            row["models"] = {}
            for mkey, mres in norm_preds[wid].items():
                hyp = _prediction_text(mres)
                m_raw = compute_cer_details(ref, hyp)
                m_norm = compute_cer_details(norm_ref, normalize_ja_text(hyp))
                quality = repetition_metrics(hyp)
                row["models"][mkey] = {
                    "hyp": hyp,
                    "normHyp": normalize_ja_text(hyp),
                    "rawCer": m_raw["cer"],
                    "normCer": m_norm["cer"],
                    "deletionRate": m_norm["deletionRate"],
                    "insertionRate": m_norm["insertionRate"],
                    "refChars": len(norm_ref),
                    "substitutions": m_norm["substitutions"],
                    "deletions": m_norm["deletions"],
                    "insertions": m_norm["insertions"],
                    "repetitionNgramExcessRate": quality["repeatedNgramExcessRate"],
                    "countsForGate": counts_for_gate,
                    "rtf": mres.get("rtf") if isinstance(mres, dict) else None,
                    "elapsedSec": mres.get("elapsedSec") if isinstance(mres, dict) else None,
                    "backend": mres.get("backend") if isinstance(mres, dict) else None,
                    "timestampSource": mres.get("timestampSource") if isinstance(mres, dict) else None,
                    "httpStatus": mres.get("httpStatus") if isinstance(mres, dict) else None,
                    "coldStart": bool(mres.get("coldStart")) if isinstance(mres, dict) else False,
                    "contractError": mres.get("contractError") if isinstance(mres, dict) else None,
                    "rssBytes": mres.get("rssBytes") if isinstance(mres, dict) else None,
                    "metalPeakBytes": mres.get("metalPeakBytes") if isinstance(mres, dict) else None,
                }

        results.append(row)

    summary: Dict[str, Any] = {
        "manifest": str(mpath),
        "totalWindows": len(windows),
        "verifiedWindows": verified_count,
        "unverifiedWindows": len(windows) - verified_count,
        "includeUnverified": include_unverified,
        "diagnosticOnly": include_unverified or verified_count < len(windows),
        "baselineYouTube": {
            "meanRawCer": round(float(np.mean(yt_raw_cers)), 4) if yt_raw_cers else None,
            "meanNormCer": round(float(np.mean(yt_norm_cers)), 4) if yt_norm_cers else None,
            "meanDeletionRate": round(float(np.mean(yt_del_rates)), 4) if yt_del_rates else None,
            "meanInsertionRate": round(float(np.mean(yt_ins_rates)), 4) if yt_ins_rates else None,
            "meanRepetitionExcessRate": round(float(np.mean(yt_repetition_rates)), 6) if yt_repetition_rates else None,
            "windowsWithInsertions": yt_windows_with_insertions,
            **summarize_cer_errors(yt_norm_errors, min_ref_chars=min_ref_chars),
        },
        "windows": results,
    }

    if norm_preds:
        model_summaries: Dict[str, Any] = {}
        model_keys = sorted({
            mkey
            for row_dict in norm_preds.values()
            for mkey in row_dict.keys()
        })

        for mkey in model_keys:
            m_raw_list = []
            m_norm_list = []
            m_del_list = []
            m_ins_list = []
            m_repetition_rates = []
            rtfs = []
            norm_errors: List[Dict[str, Any]] = []
            backends = set()
            http_statuses: Counter[str] = Counter()
            cold_start_requests = 0
            transport_error_windows = 0
            contract_error_windows = 0
            http_error_windows = 0
            native_timestamp_windows = 0
            windows_with_insertions = 0
            rss_values: List[int] = []
            metal_values: List[int] = []
            category_ref_chars: Counter[str] = Counter()

            for row in results:
                m_data = row.get("models", {}).get(mkey)
                if m_data:
                    m_raw_list.append(m_data["rawCer"])
                    m_norm_list.append(m_data["normCer"])
                    m_del_list.append(m_data["deletionRate"])
                    m_ins_list.append(m_data["insertionRate"])
                    if m_data.get("countsForGate") and m_data.get("rtf") is not None:
                        rtfs.append(m_data["rtf"])
                    if m_data.get("countsForGate"):
                        norm_errors.append({
                            "refChars": m_data["refChars"],
                            "substitutions": m_data["substitutions"],
                            "deletions": m_data["deletions"],
                            "insertions": m_data["insertions"],
                            "clusterKey": str(row.get("videoId") or row.get("id")),
                            "windowId": row.get("id"),
                        })
                        m_repetition_rates.append(m_data["repetitionNgramExcessRate"])
                        if row.get("category"):
                            category_ref_chars[str(row["category"])] += m_data["refChars"]
                        if m_data["insertions"] > 0:
                            windows_with_insertions += 1
                        if m_data.get("timestampSource") == "native":
                            native_timestamp_windows += 1
                        if m_data.get("backend"):
                            backends.add(str(m_data["backend"]))
                        if m_data.get("httpStatus") is not None:
                            http_statuses[str(m_data["httpStatus"])] += 1
                        else:
                            transport_error_windows += 1
                        if m_data.get("httpStatus") not in (None, 200):
                            http_error_windows += 1
                        if m_data.get("contractError"):
                            contract_error_windows += 1
                        if m_data.get("coldStart"):
                            cold_start_requests += 1
                        if isinstance(m_data.get("rssBytes"), (int, float)):
                            rss_values.append(int(m_data["rssBytes"]))
                        if isinstance(m_data.get("metalPeakBytes"), (int, float)):
                            metal_values.append(int(m_data["metalPeakBytes"]))

            error_summary = summarize_cer_errors(norm_errors, min_ref_chars=min_ref_chars)
            evaluated_windows = error_summary["evaluatedWindows"]
            model_summaries[mkey] = {
                **error_summary,
                "meanRawCer": round(float(np.mean(m_raw_list)), 4) if m_raw_list else 0.0,
                "meanNormCer": round(float(np.mean(m_norm_list)), 4) if m_norm_list else 0.0,
                "meanDeletionRate": round(float(np.mean(m_del_list)), 4) if m_del_list else 0.0,
                "meanInsertionRate": round(float(np.mean(m_ins_list)), 4) if m_ins_list else 0.0,
                "meanRepetitionExcessRate": round(float(np.mean(m_repetition_rates)), 6) if m_repetition_rates else 0.0,
                "windowsWithInsertions": windows_with_insertions,
                "meanRtf": round(float(np.mean(rtfs)), 4) if rtfs else 0.0,
                "backends": sorted(backends),
                "httpStatuses": dict(sorted(http_statuses.items())),
                "transportErrorWindows": transport_error_windows,
                "httpErrorWindows": http_error_windows,
                "contractErrorWindows": contract_error_windows,
                "coldStartRequests": cold_start_requests,
                "nativeTimestampWindows": native_timestamp_windows,
                "timestampCoverage": round(native_timestamp_windows / evaluated_windows, 6) if evaluated_windows else 0.0,
                "timestampsUsable": bool(evaluated_windows and native_timestamp_windows == evaluated_windows),
                "maxRssBytes": max(rss_values) if rss_values else None,
                "maxMetalPeakBytes": max(metal_values) if metal_values else None,
                "categoryRefChars": dict(sorted(category_ref_chars.items())),
            }

        summary["modelEvaluations"] = model_summaries

    return summary


def main() -> int:
    parser = argparse.ArgumentParser(description="ASR Benchmark: evaluate CER, RTF, and RAM.")
    parser.add_argument(
        "--manifest",
        default="testdata/audio-gold/manifest.json",
        help="Path to audio-gold manifest.json",
    )
    parser.add_argument(
        "--model",
        default=DEFAULT_MODEL_NAME,
        help="Single Hugging Face model repo for MLX Whisper",
    )
    parser.add_argument(
        "--models",
        default=None,
        help="Comma-separated list of Hugging Face model repos (e.g. 'mlx-community/whisper-large-v3-turbo,kaiinui/kotoba-whisper-v2.0-mlx')",
    )
    parser.add_argument(
        "--compare-dsp",
        action="store_true",
        help="Run comparative benchmark with DSP pre-processing ON vs OFF",
    )
    parser.add_argument(
        "--condition-on-previous-text",
        action="store_true",
        default=False,
        help="Condition decoding on previous text",
    )
    parser.add_argument(
        "--no-speech-threshold",
        type=float,
        default=0.85,
        help="No-speech probability threshold (default: 0.85)",
    )
    parser.add_argument(
        "--logprob-threshold",
        type=float,
        default=-1.5,
        help="Average logprob threshold (default: -1.5)",
    )
    parser.add_argument(
        "--initial-prompt",
        default=DEFAULT_INITIAL_PROMPT,
        help="Initial prompt string for Japanese ASR context",
    )
    parser.add_argument(
        "--wav-dir",
        default=None,
        help="Directory containing sliced WAV files for offline inference benchmark",
    )
    parser.add_argument(
        "--json-out",
        default=None,
        help="Path to write JSON benchmark summary",
    )
    parser.add_argument(
        "--streaming",
        action="store_true",
        help="Stitch overlapping window hypotheses and count stream references once",
    )

    args = parser.parse_args()

    # Determine models list
    if args.models:
        model_list = [m.strip() for m in args.models.split(",") if m.strip()]
    else:
        model_list = [args.model.strip()]

    # Determine DSP configurations
    dsp_configs = [True, False] if args.compare_dsp else [True]

    predictions: Optional[Dict[str, Dict[str, Any]]] = None

    if args.wav_dir:
        import soundfile as sf
        wav_path = Path(args.wav_dir)
        if wav_path.is_dir():
            predictions = {}
            with open(args.manifest, "r", encoding="utf-8") as f:
                manifest_data = json.load(f)

            windows = manifest_data.get("windows", [])
            for model_name in model_list:
                for use_dsp in dsp_configs:
                    dsp_tag = "dsp_on" if use_dsp else "dsp_off"
                    config_key = f"{model_name} [{dsp_tag}]"
                    print(f"\n--- Benchmarking {config_key} on {len(windows)} windows ---", file=sys.stderr)
                    clear_metal_cache()

                    for w in windows:
                        wid = w["id"]
                        candidates = [
                            wav_path / f"{wid}.wav",
                            wav_path / "wav" / f"{wid}.wav",
                        ]
                        if w.get("wavFile"):
                            candidates.extend([
                                wav_path / w["wavFile"],
                                Path(args.manifest).parent / w["wavFile"],
                            ])
                        w_file = next((p for p in candidates if p.is_file()), None)
                        if not w_file:
                            continue
                        if wid not in predictions:
                            predictions[wid] = {}

                        audio, sr = sf.read(str(w_file), dtype="float32")
                        tx = transcribe_audio_segment(
                            audio,
                            model_name=model_name,
                            sr=sr,
                            preprocess=use_dsp,
                            condition_on_previous_text=args.condition_on_previous_text,
                            no_speech_threshold=args.no_speech_threshold,
                            logprob_threshold=args.logprob_threshold,
                            initial_prompt=args.initial_prompt,
                        )
                        predictions[wid][config_key] = tx
                        print(f"[{wid}] CER Ref: {w.get('referenceHypothesis', '')[:20]}... -> Hyp: {tx['text'][:20]}...", file=sys.stderr)

    summary = evaluate_windows(
        manifest_path=args.manifest,
        predictions=predictions,
        streaming=args.streaming,
    )
    print(json.dumps(summary, indent=2, ensure_ascii=False))

    if args.json_out:
        out_p = Path(args.json_out)
        out_p.parent.mkdir(parents=True, exist_ok=True)
        with open(out_p, "w", encoding="utf-8") as f:
            json.dump(summary, f, indent=2, ensure_ascii=False)
        print(f"\nBenchmark summary successfully saved to: {out_p}", file=sys.stderr)

    return 0


if __name__ == "__main__":
    sys.exit(main())
