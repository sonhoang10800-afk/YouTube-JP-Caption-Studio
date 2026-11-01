"""Tests for the official-transcript ASR manifest builder."""

from __future__ import annotations

import argparse
import json

import numpy as np
import soundfile as sf

from scripts.build_official_asr_manifest import (
    _align_official_chars_with_coverage,
    align_official_chars,
    build_manifest,
    build_window_reference,
    extract_official_spoken_text,
    parse_caption_tokens,
)


def test_extract_official_spoken_text_drops_headings_and_speaker_labels():
    markdown = """
## 冒頭発言
### （1）機構改革
【大臣】冒頭、二つ御報告がございます。
 本日、機構改革を行います。

【記者】質問です。
 お答えください。
### 過去の記録
"""
    text = extract_official_spoken_text(markdown)
    assert "冒頭発言" not in text
    assert "過去の記録" not in text
    assert "【" not in text
    assert text == "冒頭、二つ御報告がございます。本日、機構改革を行います。質問です。お答えください。"


def test_extract_official_spoken_text_drops_pdf_speaker_prefixes_and_page_numbers():
    markdown = """
Title: 記者会見

Markdown Content:
広報監：これより定例記者会見を開催します。 2
知事：ハイサイ、グスーヨー、チューウガナビラ。ユタサルグトゥニ、ウニゲーサビラ。 3
記者：質問です。
"""

    text = extract_official_spoken_text(markdown)

    assert text == (
        "これより定例記者会見を開催します。"
        "ハイサイ、グスーヨー、チューウガナビラ。ユタサルグトゥニ、ウニゲーサビラ。"
        "質問です。"
    )


def test_parse_caption_tokens_uses_word_offsets_and_normalized_chars():
    payload = {
        "events": [
            {"tStartMs": 0, "dDurationMs": 1000},
            {
                "tStartMs": 1000,
                "dDurationMs": 2000,
                "segs": [
                    {"utf8": "本日"},
                    {"utf8": "の", "tOffsetMs": 500},
                ],
            },
        ]
    }
    chars, times = parse_caption_tokens(payload)
    assert chars == "本日の"
    assert times[0] == 1000
    assert times[2] == 1500


def test_parse_caption_tokens_spreads_unoffset_event_chars_across_duration():
    payload = {
        "events": [
            {
                "tStartMs": 1000,
                "dDurationMs": 2000,
                "segs": [{"utf8": "本日の会見"}],
            }
        ]
    }

    chars, times = parse_caption_tokens(payload)

    assert chars == "本日の会見"
    assert times == [1000, 1400, 1800, 2200, 2600]


def test_parse_caption_tokens_uses_next_event_span_for_long_unoffset_event():
    payload = {
        "events": [
            {
                "tStartMs": 1000,
                "dDurationMs": 2000,
                "segs": [{"utf8": "あいうえおかきくけこさしすせそたちつてと"}],
            },
            {
                "tStartMs": 5000,
                "dDurationMs": 1000,
                "segs": [{"utf8": "かきく"}],
            },
        ]
    }

    chars, times = parse_caption_tokens(payload)

    assert chars == "あいうえおかきくけこさしすせそたちつてとかきく"
    assert times == [
        1000,
        1200,
        1400,
        1600,
        1800,
        2000,
        2200,
        2400,
        2600,
        2800,
        3000,
        3200,
        3400,
        3600,
        3800,
        4000,
        4200,
        4400,
        4600,
        4800,
        5000,
        5333,
        5667,
    ]


def test_align_official_chars_maps_similar_text_across_caption_errors():
    official = "本日の閣議決定を踏まえます"
    caption = "本日の学議決定を踏まえます"
    caption_times = list(range(1000, 1000 + len(caption) * 100, 100))

    mapped = align_official_chars(official, caption, caption_times)

    assert len(mapped) == len(official)
    assert mapped[0] == 1000
    assert mapped[-1] >= 2000
    assert all(mapped[i] <= mapped[i + 1] for i in range(len(mapped) - 1))


def test_alignment_coverage_counts_short_equal_length_substitutions():
    official = "本日の閣議決定を踏まえます"
    caption = "本日の学議決定を踏まえます"
    caption_times = list(range(1000, 1000 + len(caption) * 100, 100))

    mapped, coverage = _align_official_chars_with_coverage(official, caption, caption_times)

    assert len(mapped) == len(official)
    assert all(coverage)


def test_build_window_reference_uses_only_official_text_in_exact_window():
    official = "今日は晴れです明日は雨です"
    caption = "今日は晴れです明日は雨です"
    caption_times = [0, 0, 0, 0, 0, 0, 0, 1000, 1000, 1000, 1000, 1000, 1000, 1000]

    reference, caption_text = build_window_reference(
        official,
        caption,
        caption_times,
        start_ms=0,
        end_ms=1000,
    )

    assert reference == "今日は晴れです"
    assert caption_text == "今日は晴れです"


def test_build_manifest_records_non_duplicated_stream_reference(tmp_path):
    sample_rate = 16000
    audio_path = tmp_path / "source.wav"
    sf.write(audio_path, np.zeros(sample_rate, dtype=np.float32), sample_rate, subtype="PCM_16")
    caption_path = tmp_path / "captions.json3"
    caption_text = "あいうえおかきくけこ"
    caption_path.write_text(
        json.dumps(
            {
                "events": [
                    {
                        "tStartMs": 0,
                        "segs": [
                            {"utf8": char, "tOffsetMs": index * 100}
                            for index, char in enumerate(caption_text)
                        ],
                    }
                ]
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    official_path = tmp_path / "official.md"
    official_path.write_text(
        f"Markdown Content:\n知事：{caption_text}\n",
        encoding="utf-8",
    )
    args = argparse.Namespace(
        official=str(official_path),
        captions_json3=str(caption_path),
        audio=str(audio_path),
        output_audio_dir=str(tmp_path / "windows"),
        video_id="official-video",
        video_title="Official fixture",
        channel="Official",
        transcript_url="https://example.go.jp/official",
        audio_source="fixture",
        split="holdout",
        category="clean",
        id_prefix="stream",
        description="stream reference fixture",
        created="2026-10-29",
        duration_ms=500,
        hop_ms=250,
        start_ms=None,
        end_ms=None,
        min_window_chars=1,
        max_window_chars=20,
        min_alignment_coverage=0.55,
        min_total_chars=0,
        max_windows=None,
    )

    manifest = build_manifest(args)
    windows = manifest["windows"]

    assert len(windows) == 2
    assert windows[0]["referenceHypothesis"] == "あいうえお"
    assert windows[1]["referenceHypothesis"] == "えおかきく"
    assert windows[0]["streamReference"] == "あいうえお"
    assert windows[1]["streamReference"] == "かきく"
    assert "".join(window["streamReference"] for window in windows) == "あいうえおかきく"
