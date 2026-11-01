#!/usr/bin/env python3
"""Build a deterministic, reproducible ASR stress manifest from official audio.

The selected source windows keep the official transcript as the reference. The
    quiet/noise/BGM/outro transforms are explicit test augmentations, not claims
    that those windows originally contained those acoustic conditions. Provenance
    is machine-verified and agent-reviewed, never human-approved.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
from pathlib import Path
from typing import Any, Dict, List, Sequence

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scripts.asr_benchmark import normalize_ja_text
from scripts.slice_gold_audio import load_audio, save_audio


REQUIRED_GROUPS = (
    "bgm",
    "outro",
    "noise",
    "quiet",
    "dialect",
    "homophone",
    "multi_speaker",
)
TRANSFORMS = {"none", "quiet", "noise", "bgm", "outro"}
MIN_GROUP_CHARS = 120
MIN_TOTAL_CHARS = 1200
SAMPLE_RATE = 16000


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _stable_seed(window_id: str, transform: str) -> int:
    payload = f"{window_id}:{transform}".encode("utf-8")
    return int.from_bytes(hashlib.sha256(payload).digest()[:8], "little")


def _rms(samples: np.ndarray) -> float:
    return float(np.sqrt(np.mean(np.square(samples, dtype=np.float64))))


def _music_bed(length: int, sample_rate: int, *, energy: float) -> np.ndarray:
    time = np.arange(length, dtype=np.float64) / sample_rate
    pulse = 0.72 + 0.28 * np.square(np.maximum(0.0, np.sin(2 * np.pi * 1.5 * time)))
    chord = (
        np.sin(2 * np.pi * 220.0 * time)
        + 0.75 * np.sin(2 * np.pi * 277.18 * time)
        + 0.6 * np.sin(2 * np.pi * 329.63 * time)
    ) / 2.35
    bed = chord * pulse
    current_rms = _rms(bed)
    return (bed * (energy / current_rms) if current_rms else bed).astype(np.float32)


def apply_stress_transform(
    samples: np.ndarray,
    sample_rate: int,
    transform: str,
    *,
    seed: int,
) -> np.ndarray:
    """Apply one deterministic stress condition without changing speech text."""
    audio = np.asarray(samples, dtype=np.float32).reshape(-1).copy()
    if transform == "none":
        return audio
    speech_rms = max(_rms(audio), 1e-6)
    if transform == "quiet":
        rng = np.random.default_rng(seed)
        room_noise = rng.normal(0.0, 0.0007, audio.size).astype(np.float32)
        audio = audio * 0.095 + room_noise
    elif transform == "noise":
        rng = np.random.default_rng(seed)
        noise_rms = speech_rms / (10 ** (10 / 20))
        audio = audio + rng.normal(0.0, noise_rms, audio.size).astype(np.float32)
    elif transform == "bgm":
        audio = audio + _music_bed(audio.size, sample_rate, energy=speech_rms * 0.7)
    elif transform == "outro":
        audio = audio + _music_bed(audio.size, sample_rate, energy=speech_rms * 1.25)
    else:
        raise ValueError(f"Unsupported stress transform: {transform}")

    peak = float(np.max(np.abs(audio))) if audio.size else 0.0
    if peak > 0.98:
        audio = audio * (0.98 / peak)
    return np.ascontiguousarray(audio, dtype=np.float32)


def _resolve_audio_path(value: str, source_manifest: Path) -> Path:
    path = Path(value)
    if path.is_absolute() and path.is_file():
        return path
    for root in (ROOT, source_manifest.parent):
        candidate = root / path
        if candidate.is_file():
            return candidate
    raise FileNotFoundError(f"Source audio not found: {value}")


def build_stress_manifest(
    *,
    source_manifest_path: str | Path,
    selection_path: str | Path,
    output_audio_dir: str | Path,
    id_prefix: str,
    created: str,
    min_group_chars: int = MIN_GROUP_CHARS,
    min_total_chars: int = MIN_TOTAL_CHARS,
) -> Dict[str, Any]:
    source_path = Path(source_manifest_path)
    source = json.loads(source_path.read_text(encoding="utf-8"))
    windows_by_id = {window["id"]: window for window in source.get("windows", [])}
    selection = json.loads(Path(selection_path).read_text(encoding="utf-8"))
    groups = selection.get("groups", [])

    categories = [group.get("category") for group in groups]
    if sorted(categories) != sorted(REQUIRED_GROUPS):
        raise ValueError(f"Selection must contain exactly these groups: {', '.join(REQUIRED_GROUPS)}")

    output_dir = Path(output_audio_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    output_windows: List[Dict[str, Any]] = []
    category_chars: Dict[str, int] = {}
    selected_ids = set()

    for group in groups:
        category = str(group["category"])
        transform = str(group.get("transform") or "none")
        if transform not in TRANSFORMS:
            raise ValueError(f"Unsupported transform for {category}: {transform}")
        group_chars = 0
        for index, source_id in enumerate(group.get("windowIds", []), start=1):
            if source_id in selected_ids:
                raise ValueError(f"Source window selected more than once: {source_id}")
            selected_ids.add(source_id)
            if source_id not in windows_by_id:
                raise ValueError(f"Unknown source window: {source_id}")
            source_window = windows_by_id[source_id]
            reference = str(source_window.get("referenceHypothesis") or "")
            group_chars += len(normalize_ja_text(reference))

            source_audio = _resolve_audio_path(str(source_window["audioFile"]), source_path)
            expected_sha = str(source_window.get("audioSha256") or "")
            if expected_sha and sha256_file(source_audio) != expected_sha:
                raise ValueError(f"Source audio SHA mismatch: {source_audio}")
            audio, sample_rate = load_audio(source_audio, target_sr=SAMPLE_RATE)
            if sample_rate != SAMPLE_RATE or audio.size == 0:
                raise ValueError(f"Source audio is not 16 kHz mono: {source_audio}")

            transformed = apply_stress_transform(
                audio,
                sample_rate,
                transform,
                seed=_stable_seed(source_id, transform),
            )
            window_id = f"{id_prefix}-{category}-{index:03d}"
            output_file = output_dir / f"{window_id}.wav"
            save_audio(transformed, sample_rate, output_file)
            peak = float(np.max(np.abs(transformed)))
            output_windows.append(
                {
                    **source_window,
                    "id": window_id,
                    "category": category,
                    "sourceWindowId": source_id,
                    "stressTransform": transform,
                    "sourceAudioSha256": expected_sha,
                    "audioFile": str(output_file),
                    "audioSha256": sha256_file(output_file),
                    "audioVerified": False,
                    "reviewedBy": "",
                    "reviewedAt": "",
                    "rms": round(_rms(transformed), 6),
                    "peak": round(peak, 6),
                }
            )
        category_chars[category] = group_chars

    insufficient = {
        category: chars
        for category, chars in category_chars.items()
        if chars < min_group_chars
    }
    if insufficient:
        detail = ", ".join(f"{category}={chars}" for category, chars in sorted(insufficient.items()))
        raise ValueError(f"Stress group below {min_group_chars} normalized chars: {detail}")
    total_chars = sum(category_chars.values())
    if total_chars < min_total_chars:
        raise ValueError(f"Stress total {total_chars} is below {min_total_chars} normalized chars")

    return {
        "schemaVersion": 2,
        "created": created,
        "description": "Deterministic Okinawa stress candidate; machine-verified, agent-reviewed",
        "provenance": {
            **source.get("provenance", {}),
            "sourceManifest": str(source_path),
            "stressSelection": str(selection_path),
            "augmentation": "Deterministic quiet gain, white noise, synthetic BGM and outro music",
            "verification": "Official transcript text plus test augmentation; machine-verified, agent-reviewed",
            "machineVerificationStatus": "PENDING_AGENT_REVIEW",
            "normalizedReferenceChars": total_chars,
            "categoryRefChars": category_chars,
        },
        "windows": output_windows,
    }


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-manifest", required=True)
    parser.add_argument("--selection", required=True)
    parser.add_argument("--output-manifest", required=True)
    parser.add_argument("--output-audio-dir", required=True)
    parser.add_argument("--id-prefix", required=True)
    parser.add_argument("--created", required=True)
    parser.add_argument("--min-group-chars", type=int, default=MIN_GROUP_CHARS)
    parser.add_argument("--min-total-chars", type=int, default=MIN_TOTAL_CHARS)
    args = parser.parse_args(argv)

    try:
        manifest = build_stress_manifest(
            source_manifest_path=args.source_manifest,
            selection_path=args.selection,
            output_audio_dir=args.output_audio_dir,
            id_prefix=args.id_prefix,
            created=args.created,
            min_group_chars=args.min_group_chars,
            min_total_chars=args.min_total_chars,
        )
    except Exception as error:
        print(f"ERROR: {error}", file=sys.stderr)
        return 1

    output_path = Path(args.output_manifest)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(
        json.dumps(
            {
                "manifest": str(output_path),
                "windows": len(manifest["windows"]),
                "categoryRefChars": manifest["provenance"]["categoryRefChars"],
                "normalizedReferenceChars": manifest["provenance"]["normalizedReferenceChars"],
            },
            ensure_ascii=False,
            indent=2,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
