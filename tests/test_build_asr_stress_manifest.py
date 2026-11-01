"""Tests for deterministic stress-manifest construction."""

from __future__ import annotations

import hashlib
import json

import numpy as np
import pytest
import soundfile as sf

from scripts.build_asr_stress_manifest import build_stress_manifest


GROUPS = (
    "bgm",
    "outro",
    "noise",
    "quiet",
    "dialect",
    "homophone",
    "multi_speaker",
)


def _write_source_fixture(tmp_path):
    sample_rate = 16000
    duration_sec = 1.0
    time = np.arange(round(sample_rate * duration_sec), dtype=np.float32) / sample_rate
    samples = (0.08 * np.sin(2 * np.pi * 440 * time)).astype(np.float32)
    audio_path = tmp_path / "source.wav"
    sf.write(audio_path, samples, sample_rate, subtype="PCM_16")
    digest = hashlib.sha256(audio_path.read_bytes()).hexdigest()
    windows = []
    for index, category in enumerate(GROUPS, start=1):
        windows.append(
            {
                "id": f"source-{index:03d}",
                "videoId": "official-video",
                "startMs": (index - 1) * 8000,
                "endMs": index * 8000,
                "durationMs": 8000,
                "referenceHypothesis": "あ" * 180,
                "sourceAsr": "",
                "category": "unclassified",
                "audioVerified": False,
                "verificationSource": "https://example.go.jp/official.pdf",
                "source": "https://example.go.jp/official.pdf",
                "audioFile": str(audio_path),
                "audioSha256": digest,
            }
        )
    source_manifest = tmp_path / "source-manifest.json"
    source_manifest.write_text(json.dumps({"windows": windows}, ensure_ascii=False), encoding="utf-8")
    selection = tmp_path / "selection.json"
    selection.write_text(
        json.dumps(
            {
                "schemaVersion": 1,
                "groups": [
                    {
                        "category": category,
                        "transform": "none" if category in {"dialect", "homophone", "multi_speaker"} else category,
                        "windowIds": [f"source-{index:03d}"],
                    }
                    for index, category in enumerate(GROUPS, start=1)
                ],
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    return source_manifest, selection


def test_build_stress_manifest_transforms_audio_and_keeps_agent_review_pending(tmp_path):
    source_manifest, selection = _write_source_fixture(tmp_path)
    output_audio = tmp_path / "stress"

    manifest = build_stress_manifest(
        source_manifest_path=source_manifest,
        selection_path=selection,
        output_audio_dir=output_audio,
        id_prefix="stress",
        created="2026-10-29",
    )

    assert manifest["provenance"]["machineVerificationStatus"] == "PENDING_AGENT_REVIEW"
    assert len(manifest["windows"]) == len(GROUPS)
    assert {window["category"] for window in manifest["windows"]} == set(GROUPS)
    assert all(window["audioVerified"] is False for window in manifest["windows"])
    assert all(not window["reviewedBy"] and not window["reviewedAt"] for window in manifest["windows"])

    by_category = {window["category"]: window for window in manifest["windows"]}
    levels = {}
    for category, window in by_category.items():
        audio, sample_rate = sf.read(window["audioFile"], dtype="float32")
        assert sample_rate == 16000
        assert audio.shape == (16000,)
        assert np.isfinite(audio).all()
        assert float(np.max(np.abs(audio))) <= 1.0
        levels[category] = float(np.sqrt(np.mean(np.square(audio))))

    assert levels["quiet"] < levels["dialect"]
    assert levels["noise"] > levels["dialect"]
    assert levels["bgm"] > levels["dialect"]
    assert levels["outro"] > levels["dialect"]


def test_stress_transforms_are_deterministic(tmp_path):
    source_manifest, selection = _write_source_fixture(tmp_path)
    first = build_stress_manifest(
        source_manifest_path=source_manifest,
        selection_path=selection,
        output_audio_dir=tmp_path / "first",
        id_prefix="stress-a",
        created="2026-10-29",
    )
    second = build_stress_manifest(
        source_manifest_path=source_manifest,
        selection_path=selection,
        output_audio_dir=tmp_path / "second",
        id_prefix="stress-b",
        created="2026-10-29",
    )

    assert [window["audioSha256"] for window in first["windows"]] == [
        window["audioSha256"] for window in second["windows"]
    ]


def test_stress_manifest_rejects_group_below_120_characters(tmp_path):
    source_manifest, selection = _write_source_fixture(tmp_path)
    data = json.loads(source_manifest.read_text(encoding="utf-8"))
    data["windows"][0]["referenceHypothesis"] = "あ" * 119
    source_manifest.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")

    with pytest.raises(ValueError, match="bgm.*119"):
        build_stress_manifest(
            source_manifest_path=source_manifest,
            selection_path=selection,
            output_audio_dir=tmp_path / "stress",
            id_prefix="stress",
            created="2026-10-29",
        )
