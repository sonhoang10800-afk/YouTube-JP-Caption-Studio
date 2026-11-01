#!/usr/bin/env python3
"""Build ASR gold-window manifests from an official transcript and caption timestamps.

The official transcript supplies reference text. YouTube captions supply timing
anchors only; their wording is never copied into the reference.
"""

from __future__ import annotations

import argparse
import difflib
import hashlib
import json
import re
import sys
from bisect import bisect_right
from pathlib import Path
from typing import Any, Dict, Iterable, List, Sequence, Tuple

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scripts.asr_benchmark import normalize_ja_text
from scripts.slice_gold_audio import load_audio, save_audio, slice_audio


_SPEAKER_LABEL_RE = re.compile(r"【[^】]*】")
_ROLE_LABEL_RE = re.compile(
    r"(?:^|(?<=[。！？\s]))[^\s：:。！？]{1,16}[：:]\s*",
    re.MULTILINE,
)
_MARKDOWN_LINK_RE = re.compile(r"!?\[([^\]]*)\]\([^)]*\)")
_HTML_TAG_RE = re.compile(r"<[^>]+>")
_METADATA_PREFIX_RE = re.compile(r"^(?:Title|URL Source|Published Time):", re.IGNORECASE)
_STOP_HEADING_RE = re.compile(r"^#{1,6}\s*(?:過去の記録|関連リンク|関連情報)\s*$")
_TRAILING_PAGE_NUMBER_RE = re.compile(r"(?<=[。！？」』])\s+\d{1,4}\s*$")


def extract_official_spoken_text(markdown: str) -> str:
    """Extract spoken prose from official HTML converted to Markdown.

    Navigation and metadata are omitted. Headings and speaker labels are
    structural, not spoken text. A trailing historical-record section is not
    part of the press conference and terminates extraction.
    """
    marker = "Markdown Content:"
    if marker in markdown:
        markdown = markdown.split(marker, 1)[1]

    paragraphs: List[str] = []
    for raw_line in markdown.splitlines():
        line = raw_line.strip()
        if not line:
            continue
        if _STOP_HEADING_RE.match(line):
            break
        if line.startswith("#"):
            continue
        if _METADATA_PREFIX_RE.match(line):
            continue
        if re.fullmatch(r"\d{1,4}", line):
            continue
        if line.startswith("[![") or (line.startswith("![") and "](" in line):
            continue
        line = _MARKDOWN_LINK_RE.sub(r"\1", line)
        line = _HTML_TAG_RE.sub("", line)
        line = _SPEAKER_LABEL_RE.sub("", line)
        line = _TRAILING_PAGE_NUMBER_RE.sub("", line)
        line = _ROLE_LABEL_RE.sub("", line)
        line = line.replace("**", "").replace("__", "").replace("`", "")
        line = re.sub(r"\s+", "", line)
        if line:
            paragraphs.append(line)
    return "".join(paragraphs)


def _normalize_char_with_time(char: str, time_ms: int) -> Tuple[str, int]:
    normalized = normalize_ja_text(char)
    return normalized, time_ms


def parse_caption_tokens(payload: Dict[str, Any]) -> Tuple[str, List[int]]:
    """Return normalized caption characters and one millisecond timestamp each."""
    chars: List[str] = []
    times: List[int] = []
    events = payload.get("events", [])
    populated_starts = sorted({
        int(event.get("tStartMs", 0))
        for event in events
        if normalize_ja_text("".join(str(segment.get("utf8", "")) for segment in event.get("segs", []) or []))
    })
    for event in events:
        event_start = int(event.get("tStartMs", 0))
        segments = event.get("segs", []) or []
        if segments and not any("tOffsetMs" in segment for segment in segments):
            event_chars: List[str] = []
            for segment in segments:
                for char in str(segment.get("utf8", "")):
                    event_chars.extend(normalize_ja_text(char))
            char_count = len(event_chars)
            next_index = bisect_right(populated_starts, event_start)
            next_start = populated_starts[next_index] if next_index < len(populated_starts) else None
            duration_ms = int(event.get("dDurationMs") or len(event_chars) * 100)
            if next_start is not None and next_start > event_start:
                # Auto-caption display durations are often much shorter than the
                # utterance. Use the next populated event as the timing span,
                # while capping short captions so a pause cannot stretch them.
                duration_ms = min(next_start - event_start, max(duration_ms, char_count * 500))
            for index, normalized_char in enumerate(event_chars):
                offset_ms = round(duration_ms * index / char_count) if char_count else 0
                chars.append(normalized_char)
                times.append(event_start + offset_ms)
            continue

        for segment in segments:
            token = str(segment.get("utf8", ""))
            token_time = event_start + int(segment.get("tOffsetMs", 0))
            for char in token:
                normalized, char_time = _normalize_char_with_time(char, token_time)
                for normalized_char in normalized:
                    chars.append(normalized_char)
                    times.append(char_time)

    for index in range(1, len(times)):
        times[index] = max(times[index], times[index - 1])
    return "".join(chars), times


def _caption_chars_and_times(caption: str, caption_times: Sequence[int]) -> Tuple[str, List[int]]:
    """Pair normalized caption characters with caller-supplied timestamps."""
    normalized_caption = normalize_ja_text(caption)
    if len(caption_times) == len(normalized_caption):
        return normalized_caption, [int(value) for value in caption_times]
    if len(caption_times) == len(normalized_caption) + 1:
        return normalized_caption, [int(value) for value in caption_times[:-1]]
    if len(caption_times) != len(caption):
        raise ValueError(
            f"caption/timestamp length mismatch: {len(normalized_caption)} normalized "
            f"characters, {len(caption)} source characters, {len(caption_times)} timestamps"
        )

    chars: List[str] = []
    times: List[int] = []
    for char, time_ms in zip(caption, caption_times):
        normalized = normalize_ja_text(char)
        for normalized_char in normalized:
            chars.append(normalized_char)
            times.append(int(time_ms))
    return "".join(chars), times


def _align_official_chars_with_coverage(
    official: str,
    caption: str,
    caption_times: Sequence[int],
) -> Tuple[List[int], List[bool]]:
    """Map normalized official characters to times and exact-anchor coverage.

    Exact matching blocks anchor the alignment. Official-only text between two
    anchors is interpolated by character position. This tolerates ASR caption
    substitutions, insertions, and omissions without treating captions as truth.
    """
    official_text = normalize_ja_text(official)
    caption_text, normalized_times = _caption_chars_and_times(caption, caption_times)
    if not official_text:
        return [], []
    if not caption_text:
        raise ValueError("caption has no normalized characters")

    matcher = difflib.SequenceMatcher(a=official_text, b=caption_text, autojunk=False)
    opcodes = matcher.get_opcodes()
    anchors: Dict[int, int] = {}
    for block in matcher.get_matching_blocks():
        for offset in range(block.size):
            official_index = block.a + offset
            caption_index = block.b + offset
            anchors[official_index] = int(normalized_times[caption_index])

    for index, (tag, official_start, official_end, caption_start, caption_end) in enumerate(opcodes):
        span = official_end - official_start
        has_equal_flanks = (
            0 < index < len(opcodes) - 1
            and opcodes[index - 1][0] == "equal"
            and opcodes[index + 1][0] == "equal"
        )
        if tag != "replace" or not has_equal_flanks or span != caption_end - caption_start or span > 3:
            continue
        for offset in range(span):
            anchors[official_start + offset] = int(normalized_times[caption_start + offset])

    if not anchors:
        raise ValueError("official transcript and caption timestamps have no alignment anchor")
    if len(anchors) / len(official_text) < 0.25:
        raise ValueError(
            f"alignment coverage too low: {len(anchors)}/{len(official_text)} official characters"
        )

    anchor_positions = sorted(anchors)
    mapped: List[int] = []
    coverage = [False] * len(official_text)
    anchor_cursor = 0
    for official_index in range(len(official_text)):
        if official_index in anchors:
            mapped.append(anchors[official_index])
            coverage[official_index] = True
            continue

        while (
            anchor_cursor + 1 < len(anchor_positions)
            and anchor_positions[anchor_cursor + 1] < official_index
        ):
            anchor_cursor += 1
        left = anchor_positions[anchor_cursor]
        if left > official_index:
            mapped.append(anchors[left])
            continue
        if anchor_cursor + 1 >= len(anchor_positions):
            mapped.append(anchors[left])
            continue
        right = anchor_positions[anchor_cursor + 1]
        span = right - left
        ratio = (official_index - left) / span if span else 0.0
        interpolated = round(anchors[left] + ratio * (anchors[right] - anchors[left]))
        mapped.append(max(anchors[left], min(anchors[right], int(interpolated))))

    for index in range(1, len(mapped)):
        mapped[index] = max(mapped[index], mapped[index - 1])
    return mapped, coverage


def align_official_chars(
    official: str,
    caption: str,
    caption_times: Sequence[int],
) -> List[int]:
    """Map every normalized official character to a monotonic caption time."""
    mapped, _coverage = _align_official_chars_with_coverage(official, caption, caption_times)
    return mapped


def _build_window_reference_with_coverage(
    official: str,
    caption: str,
    caption_times: Sequence[int],
    *,
    start_ms: int,
    end_ms: int,
) -> Tuple[str, str, float]:
    if end_ms <= start_ms:
        raise ValueError(f"end_ms ({end_ms}) must be greater than start_ms ({start_ms})")

    official_text = normalize_ja_text(official)
    caption_text, normalized_times = _caption_chars_and_times(caption, caption_times)
    mapped_times, anchor_coverage = _align_official_chars_with_coverage(
        official_text, caption_text, normalized_times
    )
    selected_indices = [
        index for index, time_ms in enumerate(mapped_times) if start_ms <= time_ms < end_ms
    ]
    reference = "".join(official_text[index] for index in selected_indices)
    caption_slice = "".join(
        char for char, time_ms in zip(caption_text, normalized_times) if start_ms <= time_ms < end_ms
    )
    aligned = sum(anchor_coverage[index] for index in selected_indices)
    coverage_ratio = aligned / len(selected_indices) if selected_indices else 0.0
    return reference, caption_slice, coverage_ratio


def build_window_reference(
    official: str,
    caption: str,
    caption_times: Sequence[int],
    *,
    start_ms: int,
    end_ms: int,
) -> Tuple[str, str]:
    """Select official and caption text anchored inside ``[start_ms, end_ms)``."""
    if end_ms <= start_ms:
        raise ValueError(f"end_ms ({end_ms}) must be greater than start_ms ({start_ms})")

    reference, caption_slice, _coverage = _build_window_reference_with_coverage(
        official,
        caption,
        caption_times,
        start_ms=start_ms,
        end_ms=end_ms,
    )
    return reference, caption_slice


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _window_starts(first_ms: int, last_ms: int, duration_ms: int, hop_ms: int) -> Iterable[int]:
    start = max(0, first_ms)
    while start + duration_ms <= last_ms:
        yield start
        start += hop_ms


def build_manifest(args: argparse.Namespace) -> Dict[str, Any]:
    official = extract_official_spoken_text(Path(args.official).read_text(encoding="utf-8"))
    caption_payload = json.loads(Path(args.captions_json3).read_text(encoding="utf-8"))
    caption, caption_times = parse_caption_tokens(caption_payload)
    if not caption_times:
        raise ValueError("caption file has no timestamps")

    audio, sample_rate = load_audio(args.audio, target_sr=16000)
    audio_end_ms = round(len(audio) * 1000 / sample_rate)
    first_ms = args.start_ms if args.start_ms is not None else caption_times[0]
    last_ms = args.end_ms if args.end_ms is not None else min(caption_times[-1], audio_end_ms)
    if last_ms <= first_ms:
        raise ValueError(f"invalid source range: {first_ms}..{last_ms}")

    Path(args.output_audio_dir).mkdir(parents=True, exist_ok=True)
    windows: List[Dict[str, Any]] = []
    used_chars = 0
    attempt = 0
    previous_kept_end_ms = first_ms
    for start_ms in _window_starts(first_ms, last_ms, args.duration_ms, args.hop_ms):
        end_ms = start_ms + args.duration_ms
        reference, caption_slice, alignment_coverage = _build_window_reference_with_coverage(
            official,
            caption,
            caption_times,
            start_ms=start_ms,
            end_ms=end_ms,
        )
        if (
            len(reference) < args.min_window_chars
            or len(reference) > args.max_window_chars
            or alignment_coverage < args.min_alignment_coverage
        ):
            continue
        stream_reference, _stream_caption_slice = build_window_reference(
            official,
            caption,
            caption_times,
            start_ms=max(start_ms, previous_kept_end_ms),
            end_ms=end_ms,
        )
        attempt += 1
        window_id = f"{args.id_prefix}-{attempt:03d}"
        output_wav = Path(args.output_audio_dir) / f"{window_id}.wav"
        save_audio(slice_audio(audio, sample_rate, start_ms, end_ms), sample_rate, output_wav)
        windows.append(
            {
                "id": window_id,
                "videoId": args.video_id,
                "startMs": start_ms,
                "endMs": end_ms,
                "durationMs": end_ms - start_ms,
                "split": args.split,
                "category": args.category,
                "referenceHypothesis": reference,
                "streamReference": stream_reference,
                "sourceAsr": caption_slice,
                "alignmentCoverage": round(alignment_coverage, 4),
                "audioVerified": False,
                "verificationSource": args.transcript_url,
                "source": args.transcript_url,
                "sourceKind": "official_transcript_aligned_by_caption",
                "reviewedBy": "",
                "reviewedAt": "",
                "audioFile": str(output_wav),
                "audioSha256": sha256_file(output_wav),
            }
        )
        previous_kept_end_ms = end_ms
        # The benchmark stitches windows with overlap removed; counting the
        # overlapping per-window reference here would overstate the gate
        # denominator and stop the corpus before the unique stream reaches
        # 2,400 characters.
        used_chars += len(stream_reference)
        if args.max_windows and len(windows) >= args.max_windows:
            break
        if args.min_total_chars and used_chars >= args.min_total_chars:
            break

    if not windows:
        raise ValueError("no windows contained enough aligned official speech")

    return {
        "schemaVersion": 2,
        "created": args.created,
        "description": args.description,
        "provenance": {
            "videoId": args.video_id,
            "videoTitle": args.video_title,
            "channel": args.channel,
            "transcriptUrl": args.transcript_url,
            "audioSource": args.audio_source,
            "timestampSource": "YouTube captions used only as timing anchors",
            "verification": "Official transcript text; machine-verified, agent-reviewed",
            "audioSamplingRate": sample_rate,
            "channels": 1,
            "windowDurationMs": args.duration_ms,
            "windowHopMs": args.hop_ms,
            "machineVerificationStatus": "PENDING_AGENT_REVIEW",
        },
        "windows": windows,
    }


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--official", required=True, help="Official transcript Markdown/text")
    parser.add_argument("--captions-json3", required=True, help="YouTube json3 timing anchors")
    parser.add_argument("--audio", required=True, help="Full source audio")
    parser.add_argument("--output-manifest", required=True)
    parser.add_argument("--output-audio-dir", required=True)
    parser.add_argument("--video-id", required=True)
    parser.add_argument("--video-title", required=True)
    parser.add_argument("--channel", required=True)
    parser.add_argument("--transcript-url", required=True)
    parser.add_argument("--audio-source", required=True)
    parser.add_argument("--split", choices=["holdout", "stress", "tune", "diagnostic"], default="holdout")
    parser.add_argument("--category", default="clean")
    parser.add_argument("--id-prefix", required=True)
    parser.add_argument("--description", required=True)
    parser.add_argument("--created", required=True)
    parser.add_argument("--duration-ms", type=int, default=8000)
    parser.add_argument("--hop-ms", type=int, default=8000)
    parser.add_argument("--start-ms", type=int, default=None)
    parser.add_argument("--end-ms", type=int, default=None)
    parser.add_argument("--min-window-chars", type=int, default=20)
    parser.add_argument("--max-window-chars", type=int, default=120)
    parser.add_argument("--min-alignment-coverage", type=float, default=0.55)
    parser.add_argument("--min-total-chars", type=int, default=2400)
    parser.add_argument("--max-windows", type=int, default=None)
    args = parser.parse_args(argv)

    try:
        manifest = build_manifest(args)
        output_path = Path(args.output_manifest)
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_text(
            json.dumps(manifest, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        total_chars = sum(len(window["referenceHypothesis"]) for window in manifest["windows"])
        print(
            json.dumps(
                {
                    "manifest": str(output_path),
                    "windows": len(manifest["windows"]),
                    "normalizedReferenceChars": total_chars,
                    "audioVerifiedWindows": sum(bool(w["audioVerified"]) for w in manifest["windows"]),
                },
                ensure_ascii=False,
                indent=2,
            )
        )
        return 0
    except Exception as error:
        print(f"ERROR: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
