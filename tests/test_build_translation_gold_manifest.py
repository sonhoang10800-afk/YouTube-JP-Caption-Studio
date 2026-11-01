"""Integrity checks for the frozen translation-quality corpus."""

from __future__ import annotations

import json
from pathlib import Path


MANIFEST = Path("testdata/translation-gold/mofa-2026-01-09.20cue.manifest.json")


def _intersection_coverage(cue: dict) -> float:
    start_ms = cue["startMs"]
    end_ms = cue["endMs"]
    intervals = sorted(
        (
            max(start_ms, window["startMs"]),
            min(end_ms, window["endMs"]),
        )
        for window in cue["audioWindows"]
        if window["endMs"] > start_ms and window["startMs"] < end_ms
    )
    covered_ms = 0
    covered_until = start_ms
    for start, end in intervals:
        if start > covered_until:
            covered_until = start
        if end > covered_until:
            covered_ms += end - covered_until
            covered_until = end
    return covered_ms / (end_ms - start_ms)


def test_every_translation_cue_has_complete_audio_coverage():
    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))

    assert len(manifest["cues"]) == 20
    for cue in manifest["cues"]:
        assert cue["audioWindows"], f"{cue['id']} has no audio"
        assert _intersection_coverage(cue) == 1.0, f"{cue['id']} audio does not cover its interval"


def test_translation_audio_clips_are_exact_cue_slices():
    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))

    for cue in manifest["cues"]:
        assert len(cue["audioWindows"]) == 1, f"{cue['id']} should have one exact clip"
        window = cue["audioWindows"][0]
        assert window["startMs"] == cue["startMs"]
        assert window["endMs"] == cue["endMs"]
