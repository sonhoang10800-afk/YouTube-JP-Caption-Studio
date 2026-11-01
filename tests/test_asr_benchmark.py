"""Unit tests for scripts/asr_benchmark.py.

Verifies:
- Japanese normalization invariant (NFKC, bracketed noise stripping, Latin lowercasing, prolonged mark preservation).
- Bug fix regression: Latin letters (A, M, S, etc.) are NOT stripped by character filtering.
- Dynamic programming Levenshtein distance accuracy.
- CER and Normalized CER calculations across all edge cases (empty strings, deletions, punctuation invariance).
- Process RSS memory measurement.
- Manifest evaluation runner over testdata/audio-gold/manifest.json.
"""

from pathlib import Path

import pytest

from scripts.asr_benchmark import (
    CER_PASS_THRESHOLD,
    MIN_STRESS_REF_CHARS,
    STRESS_MARGIN,
    compute_cer,
    compute_cer_details,
    compute_normalized_cer,
    evaluate_windows,
    get_metal_peak_memory_bytes,
    get_process_rss_bytes,
    is_window_verified,
    normalize_ja_text,
    repetition_metrics,
    select_model_and_dsp,
    stitch_predictions,
    stitch_transcripts,
    summarize_cer_errors_with_clusters,
    summarize_cer_errors,
    summarize_stress_gate,
    wilson_interval,
)


def _verified(window):
    return {
        **window,
        "audioVerified": True,
        "verificationSource": "https://example.go.jp/official-transcript",
        "reviewedBy": "agent:reviewer-a",
        "reviewKind": "agent-official-crosscheck",
        "reviewedAt": "2026-10-29",
        "audioSha256": "a" * 64,
    }


def test_gate_rejects_human_like_reviewer_labels_without_agent_provenance():
    window = _verified({"id": "a", "videoId": "v", "referenceHypothesis": "あ"})
    window["reviewKind"] = ""
    window["reviewedBy"] = "reviewer-a"
    assert is_window_verified(window) is False

    window["reviewKind"] = "agent-official-crosscheck"
    window["reviewedBy"] = "human:reviewer-a"
    assert is_window_verified(window) is False


def levenshtein_distance(ref: str, hyp: str) -> int:
    """Edit distance from the production breakdown (subs + dels + insertions)."""
    details = compute_cer_details(ref, hyp)
    return details["substitutions"] + details["deletions"] + details["insertions"]


def test_normalize_ja_text_empty_and_none():
    """Empty and None inputs should return empty string."""
    assert normalize_ja_text(None) == ""
    assert normalize_ja_text("") == ""
    assert normalize_ja_text("   \n\t  ") == ""


def test_normalize_ja_text_brackets_and_noise():
    """Bracketed noise tokens (halfwidth and fullwidth) should be stripped."""
    assert normalize_ja_text("味ちけたら[音楽]です。") == "味ちけたらです"
    assert normalize_ja_text("ありがと(拍手)うございます[ため息]") == "ありがとうございます"
    assert normalize_ja_text("曲の終わり【音楽】です〔拍手〕") == "曲の終わりです"


def test_normalize_ja_text_iteration_mark():
    """Japanese kanji iteration mark 々 (\\u3005) must be preserved."""
    assert normalize_ja_text("時々佐々木様々色々な") == "時々佐々木様々色々な"
    assert normalize_ja_text("人々の日々の努力") == "人々の日々の努力"


def test_normalize_ja_text_latin_preservation():
    """Regression test: Latin characters (e.g., Apple Music, Spotify) must NOT be deleted."""
    # Prior buggy code deleted uppercase letters; ensure proper preservation & lowercasing
    raw = "AppleミッとかSpotifyとかで"
    norm = normalize_ja_text(raw)
    assert "apple" in norm
    assert "spotify" in norm
    assert norm == "appleミッとかspotifyとかで"


def test_normalize_ja_text_prolonged_sound_mark():
    """Katakana prolonged sound mark ー (\\u30FC) must be preserved."""
    assert normalize_ja_text("ありがとー") == "ありがとー"
    assert normalize_ja_text("スーパーマーケット") == "スーパーマーケット"


def test_normalize_ja_text_punctuation_and_whitespace():
    """Punctuation marks and whitespace must be stripped."""
    raw = "おはよう。 早え！ 教室間違えてない？"
    norm = normalize_ja_text(raw)
    assert norm == "おはよう早え教室間違えてない"


def test_normalize_ja_text_fullwidth_ascii():
    """Fullwidth ASCII characters and numbers must normalize to halfwidth via NFKC."""
    raw = "第１弾 Ａｐｐｌｅ"
    norm = normalize_ja_text(raw)
    assert norm == "第1弾apple"


def test_levenshtein_distance_basic():
    """Basic Levenshtein edit distance calculations."""
    assert levenshtein_distance("", "") == 0
    assert levenshtein_distance("abc", "abc") == 0
    assert levenshtein_distance("", "abc") == 3
    assert levenshtein_distance("abc", "") == 3
    assert levenshtein_distance("kitten", "sitting") == 3


def test_levenshtein_distance_japanese_homophones():
    """Levenshtein distance on Japanese kanji strings."""
    # 勘無料 (3 chars) vs 感無量 (3 chars): 勘 vs 感 (1 sub), 料 vs 量 (1 sub) -> dist = 2
    assert levenshtein_distance("勘無料", "感無量") == 2
    assert levenshtein_distance("どんな理由だよ。ああ、勘無料だよ。", "どんな理由だよ。ああ、感無量だよ。") == 2


def test_compute_cer_edge_cases():
    """Edge cases for Character Error Rate."""
    assert compute_cer("", "") == 0.0
    assert compute_cer("abc", "abc") == 0.0
    assert compute_cer("", "abc") == 1.0
    assert compute_cer("abc", "") == 1.0


def test_compute_cer_metric_values():
    """Test CER value calculation with substitutions and deletions."""
    ref = "感無量"
    hyp = "勘無料"
    # 2 substitutions / 3 reference chars = 0.6667
    cer = compute_cer(ref, hyp)
    assert abs(cer - (2.0 / 3.0)) < 1e-4


def test_compute_normalized_cer_punctuation_invariance():
    """Normalized CER should be 0.0 when differences are purely punctuation or whitespace."""
    ref = "おはよう。早え！教室間違えてない？"
    hyp = "おはようはえ教室間違えてない"
    # Notice: '早え' vs 'はえ' has 1 substitution, but punctuation is ignored
    raw_cer = compute_cer(ref, hyp)
    norm_cer = compute_normalized_cer(ref, hyp)

    # Raw CER penalizes the missing punctuation; Normalized CER evaluates only lexical text
    assert norm_cer < raw_cer

    # Pure punctuation difference
    assert compute_normalized_cer("おはよう。", "おはよう") == 0.0
    assert compute_normalized_cer("なんで？", "なんで") == 0.0


def test_get_process_rss_bytes():
    """Process RSS memory must return a positive integer."""
    rss = get_process_rss_bytes()
    assert isinstance(rss, int)
    assert rss > 0
    # Process memory should typically be at least 10 MB (10 * 1024 * 1024 bytes)
    assert rss > 10 * 1024 * 1024


def test_get_metal_peak_memory_bytes():
    """Metal peak memory should return None or an integer >= 0."""
    metal_mem = get_metal_peak_memory_bytes()
    if metal_mem is not None:
        assert isinstance(metal_mem, int)
        assert metal_mem >= 0


def test_evaluate_windows_manifest():
    """Evaluate windows on testdata/audio-gold/manifest.json."""
    manifest_path = Path("testdata/audio-gold/manifest.json")
    assert manifest_path.is_file()

    summary = evaluate_windows(manifest_path=manifest_path)
    assert summary["totalWindows"] == 20
    assert "baselineYouTube" in summary
    assert "meanRawCer" in summary["baselineYouTube"]
    assert "meanNormCer" in summary["baselineYouTube"]
    assert len(summary["windows"]) == 20

    # Test with simulated model predictions (correcting Window #6 homophone error)
    simulated_preds = {
        "gold-06": "どんな理由だよ。ああ、感無量だよ。"
    }
    summary_with_preds = evaluate_windows(
        manifest_path=manifest_path,
        predictions=simulated_preds,
    )
    # The shipped candidate manifest is not human verified, so it cannot enter
    # the acceptance denominator even when a prediction is present.
    assert "modelEvaluations" in summary_with_preds
    assert summary_with_preds["verifiedWindows"] == 0
    assert summary_with_preds["modelEvaluations"]["default"]["evaluatedWindows"] == 0
    assert summary_with_preds["modelEvaluations"]["default"]["verdict"] == "NOT_PROVEN"
    # On Window #6, simulated prediction exactly matches reference -> norm CER = 0.0
    win6 = [w for w in summary_with_preds["windows"] if w["id"] == "gold-06"][0]
    assert win6["models"]["default"]["normCer"] == 0.0
    assert win6["ytNormCer"] > 0.0  # YouTube ASR had 勘無料 error


def test_evaluate_windows_uses_total_character_cer(tmp_path):
    """CER must be total errors / total reference characters, not mean(window CER)."""
    import json

    manifest = {
        "windows": [
            # Equal-length windows with errors 0/10 and 1/10. Mean-window CER = 5%.
            # The required aggregate CER is 1/20 = 5% here; choose different lengths
            # to separate the two formulas.
            _verified({"id": "a", "videoId": "v", "referenceHypothesis": "ああああああああああ", "sourceAsr": ""}),
            _verified({"id": "b", "videoId": "v", "referenceHypothesis": "い", "sourceAsr": "う"}),
        ]
    }
    path = tmp_path / "manifest.json"
    path.write_text(json.dumps(manifest, ensure_ascii=False), encoding="utf-8")
    summary = evaluate_windows(
        path,
        predictions={"a": "ああああああああああ", "b": "う"},
    )

    # errors: a=0/10, b=1/1 -> total 1/11. Mean per-window CER would be (0 + 1)/2 = 50%.
    aggregate = summary["modelEvaluations"]["default"]
    assert aggregate["totalRefChars"] == 11
    assert aggregate["totalErrors"] == 1
    assert aggregate["normCer"] == pytest.approx(1 / 11, abs=1e-6)
    assert aggregate["normCer"] != pytest.approx(0.5)


def test_streaming_evaluation_counts_overlap_once_and_stitches_hypotheses(tmp_path):
    """Streaming CER must not penalize the 1.5 s production overlap twice."""
    import json

    manifest = {
        "windows": [
            _verified({
                "id": "a",
                "videoId": "video-a",
                "startMs": 0,
                "endMs": 8000,
                "referenceHypothesis": "あいうえお",
                "streamReference": "あいうえお",
                "sourceAsr": "あいうえお",
            }),
            _verified({
                "id": "b",
                "videoId": "video-a",
                "startMs": 6500,
                "endMs": 14500,
                "referenceHypothesis": "いうえおかきく",
                "streamReference": "かきく",
                "sourceAsr": "いうえおかきく",
            }),
        ]
    }
    path = tmp_path / "manifest.json"
    path.write_text(json.dumps(manifest, ensure_ascii=False), encoding="utf-8")

    summary = evaluate_windows(
        path,
        predictions={
            "a": "あいうえお",
            "b": "いうえおかきく",
        },
        min_ref_chars=1,
        streaming=True,
    )

    assert summary["streaming"] is True
    assert len(summary["streams"]) == 1
    assert summary["streams"][0]["reference"] == "あいうえおかきく"
    assert summary["streams"][0]["hypotheses"]["default"] == "あいうえおかきく"
    result = summary["modelEvaluations"]["default"]
    assert result["totalRefChars"] == 8
    assert result["totalErrors"] == 0
    assert result["evaluatedStreams"] == 1
    assert result["evaluatedWindows"] == 2
    by_id = {row["id"]: row for row in summary["windows"]}
    assert by_id["a"]["models"]["default"]["hyp"] == "あいうえお"
    assert by_id["b"]["models"]["default"]["hyp"] == "いうえおかきく"


def test_streaming_evaluation_breaks_stream_at_time_gap(tmp_path):
    """A gap between windows starts a new stream instead of fuzzy-joining them."""
    import json

    manifest = {
        "windows": [
            _verified({
                "id": "a",
                "videoId": "video-a",
                "startMs": 0,
                "endMs": 1000,
                "referenceHypothesis": "あいうえお",
                "streamReference": "あいうえお",
                "sourceAsr": "あいうえお",
            }),
            _verified({
                "id": "b",
                "videoId": "video-a",
                "startMs": 2000,
                "endMs": 3000,
                "referenceHypothesis": "かきくけこ",
                "streamReference": "かきくけこ",
                "sourceAsr": "かきくけこ",
            }),
        ]
    }
    path = tmp_path / "manifest.json"
    path.write_text(json.dumps(manifest, ensure_ascii=False), encoding="utf-8")

    summary = evaluate_windows(
        path,
        predictions={"a": "あいうえお", "b": "かきくけこ"},
        min_ref_chars=1,
        streaming=True,
    )

    assert len(summary["streams"]) == 2
    assert summary["modelEvaluations"]["default"]["evaluatedStreams"] == 2
    assert summary["modelEvaluations"]["default"]["totalRefChars"] == 10


def test_streaming_evaluation_uses_segment_time_for_overlap(tmp_path):
    """Segment timestamps must trim the known overlap before fuzzy text matching."""
    import json

    manifest = {
        "windows": [
            _verified({
                "id": "a",
                "videoId": "video-a",
                "startMs": 0,
                "endMs": 8000,
                "referenceHypothesis": "あいうえお",
                "streamReference": "あいうえお",
                "sourceAsr": "あいうえお",
            }),
            _verified({
                "id": "b",
                "videoId": "video-a",
                "startMs": 6500,
                "endMs": 14500,
                "referenceHypothesis": "いうえおかきく",
                "streamReference": "かきく",
                "sourceAsr": "いうえおかきく",
            }),
        ]
    }
    path = tmp_path / "manifest.json"
    path.write_text(json.dumps(manifest, ensure_ascii=False), encoding="utf-8")

    summary = evaluate_windows(
        path,
        predictions={
            "a": {
                "text": "あいうえお",
                "segments": [{"start": 0.0, "end": 1.5, "text": "あいうえお"}],
            },
            "b": {
                "text": "いうえおかきく",
                "segments": [
                    {"start": 0.0, "end": 1.5, "text": "いうえお"},
                    {"start": 1.5, "end": 3.0, "text": "かきく"},
                ],
            },
        },
        min_ref_chars=1,
        streaming=True,
    )

    assert summary["streams"][0]["hypotheses"]["default"] == "あいうえおかきく"
    assert summary["modelEvaluations"]["default"]["totalErrors"] == 0


def test_streaming_evaluation_does_not_trim_unsplit_segment_by_character_ratio(tmp_path):
    """An ASR segment that spans the overlap must be merged, not cut proportionally."""
    import json

    manifest = {
        "windows": [
            _verified({
                "id": "a",
                "videoId": "video-a",
                "startMs": 0,
                "endMs": 8000,
                "referenceHypothesis": "ず私の",
                "streamReference": "ず私の",
                "sourceAsr": "ず私の",
            }),
            _verified({
                "id": "b",
                "videoId": "video-a",
                "startMs": 6500,
                "endMs": 14500,
                "referenceHypothesis": "ず私の海外出張について",
                "streamReference": "海外出張について",
                "sourceAsr": "ず私の海外出張について",
            }),
        ]
    }
    path = tmp_path / "manifest.json"
    path.write_text(json.dumps(manifest, ensure_ascii=False), encoding="utf-8")

    summary = evaluate_windows(
        path,
        predictions={
            "a": {
                "text": "ず私の",
                "segments": [{"start": 0.0, "end": 0.5, "text": "ず私の"}],
            },
            "b": {
                # The engine skipped the overlapping words and returned one
                # segment that happens to span the 1.5-second boundary.
                "text": "海外市長について",
                "segments": [{"start": 0.0, "end": 4.02, "text": "海外市長について"}],
            },
        },
        min_ref_chars=1,
        streaming=True,
    )

    assert summary["streams"][0]["hypotheses"]["default"] == "ず私の海外市長について"


def test_stitch_predictions_falls_back_without_segments():
    windows = [
        {"startMs": 0, "endMs": 8000},
        {"startMs": 6500, "endMs": 14500},
    ]
    stitched = stitch_predictions(["あいうえお", "いうえおかきく"], windows)
    assert stitched == "あいうえおかきく"


def test_streaming_evaluation_breaks_stream_at_adjacent_non_overlap(tmp_path):
    """Windows that merely touch have no shared speech to stitch."""
    import json

    manifest = {
        "windows": [
            _verified({
                "id": "a",
                "videoId": "video-a",
                "startMs": 0,
                "endMs": 1000,
                "referenceHypothesis": "あいうえお",
                "sourceAsr": "あいうえお",
            }),
            _verified({
                "id": "b",
                "videoId": "video-a",
                "startMs": 1000,
                "endMs": 2000,
                "referenceHypothesis": "かきくけこ",
                "sourceAsr": "かきくけこ",
            }),
        ]
    }
    path = tmp_path / "manifest.json"
    path.write_text(json.dumps(manifest, ensure_ascii=False), encoding="utf-8")

    summary = evaluate_windows(
        path,
        predictions={"a": "あいうえお", "b": "かきくけこ"},
        min_ref_chars=1,
        streaming=True,
    )

    assert len(summary["streams"]) == 2
    assert summary["modelEvaluations"]["default"]["evaluatedStreams"] == 2
    assert summary["modelEvaluations"]["default"]["totalRefChars"] == 10


def test_evaluate_windows_marks_small_corpus_not_proven(tmp_path):
    """A corpus under 2,400 verified characters can never be PASS, even at CER 0."""
    import json

    manifest = {
        "windows": [
            {
                **_verified({
                    "id": "a",
                    "videoId": "v",
                    "referenceHypothesis": "あいうえお",
                    "sourceAsr": "あいうえお",
                }),
            }
        ]
    }
    path = tmp_path / "manifest.json"
    path.write_text(json.dumps(manifest, ensure_ascii=False), encoding="utf-8")
    summary = evaluate_windows(path, predictions={"a": "あいうえお"})

    result = summary["modelEvaluations"]["default"]
    assert result["totalRefChars"] == 5
    assert result["normCer"] == 0.0
    assert result["verdict"] == "NOT_PROVEN"
    assert result["thresholdMet"] is False


def test_unverified_windows_never_enter_the_gate_denominator(tmp_path):
    """Only fully reviewed windows may contribute reference characters."""
    import json

    manifest = {
        "windows": [
            {
                "id": "verified",
                "videoId": "v",
                "referenceHypothesis": "あいうえお",
                "sourceAsr": "あいうえお",
                "audioVerified": True,
                "verificationSource": "https://example.go.jp/official-transcript",
                "reviewedBy": "agent:reviewer-a",
                "reviewKind": "agent-official-crosscheck",
                "reviewedAt": "2026-10-29",
                "audioSha256": "a" * 64,
            },
            {
                "id": "candidate",
                "videoId": "v",
                "referenceHypothesis": "かきくけこさしすせそ",
                "sourceAsr": "かきくけこさしすせそ",
                "audioVerified": False,
            },
        ]
    }
    path = tmp_path / "manifest.json"
    path.write_text(json.dumps(manifest, ensure_ascii=False), encoding="utf-8")
    summary = evaluate_windows(
        path,
        predictions={"verified": "あいうえお", "candidate": "かきくけこさしすせそ"},
    )

    result = summary["modelEvaluations"]["default"]
    assert summary["verifiedWindows"] == 1
    assert result["evaluatedWindows"] == 1
    assert result["totalRefChars"] == 5
    assert result["verdict"] == "NOT_PROVEN"


def _errors(ref_chars: int, substitutions: int = 0, deletions: int = 0, insertions: int = 0):
    return [{
        "refChars": ref_chars,
        "substitutions": substitutions,
        "deletions": deletions,
        "insertions": insertions,
    }]


def _full_stress_categories(total: int = 1200):
    groups = {
        "bgm": 120,
        "outro": 120,
        "noise": 120,
        "quiet": 120,
        "dialect": 120,
        "homophone": 120,
        "multi_speaker": 120,
    }
    groups["multi_speaker"] += max(0, total - sum(groups.values()))
    return groups


def test_clean_gate_is_five_percent_on_total_characters():
    assert CER_PASS_THRESHOLD == 0.05
    at_gate = summarize_cer_errors(_errors(2400, substitutions=120))
    over_gate = summarize_cer_errors(_errors(2400, substitutions=121))
    assert at_gate["verdict"] == "PASS"
    assert at_gate["normCer"] == pytest.approx(0.05)
    assert over_gate["verdict"] == "FAIL"


def test_clean_gate_stays_not_proven_below_2400_chars():
    result = summarize_cer_errors(_errors(2399))
    assert MIN_STRESS_REF_CHARS == 1200
    assert result["normCer"] == 0.0
    assert result["verdict"] == "NOT_PROVEN"


def test_stress_gate_uses_clean_plus_two_points():
    assert STRESS_MARGIN == 0.02
    clean = summarize_cer_errors(_errors(2400, substitutions=96))          # 4.0%
    stress_pass = summarize_cer_errors(_errors(1200, substitutions=72))     # 6.0%
    stress_fail = summarize_cer_errors(_errors(1200, substitutions=73))     # 6.083%
    stress_pass["categoryRefChars"] = _full_stress_categories()
    stress_fail["categoryRefChars"] = _full_stress_categories()

    passed = summarize_stress_gate(clean, stress_pass)
    failed = summarize_stress_gate(clean, stress_fail)
    assert passed["verdict"] == "PASS"
    assert passed["maxAllowedCer"] == pytest.approx(0.06)
    assert failed["verdict"] == "FAIL"


def test_stress_gate_requires_1200_verified_chars():
    clean = summarize_cer_errors(_errors(2400, substitutions=96))
    stress = summarize_cer_errors(_errors(1199, substitutions=50))
    result = summarize_stress_gate(clean, stress)
    assert result["verdict"] == "NOT_PROVEN"


def test_stress_gate_requires_120_chars_in_each_named_group():
    clean = summarize_cer_errors(_errors(2400, substitutions=96))
    stress = summarize_cer_errors(_errors(1200, substitutions=24))
    stress["categoryRefChars"] = {
        "bgm": 120,
        "outro": 120,
        "noise": 120,
        "quiet": 120,
        "dialect": 119,
        "homophone": 120,
        "multi_speaker": 481,
    }

    result = summarize_stress_gate(clean, stress)

    assert result["verdict"] == "NOT_PROVEN"
    assert result["insufficientGroups"] == ["dialect"]


def test_wilson_interval_is_bounded_and_contains_point_estimate():
    low, high = wilson_interval(errors=10, total=100)
    assert 0.0 <= low < 0.10 < high <= 1.0
    assert low == pytest.approx(0.0552, abs=0.002)
    assert high == pytest.approx(0.1747, abs=0.002)


def test_wilson_interval_handles_insertion_heavy_cer_above_one_hundred_percent():
    result = summarize_cer_errors(_errors(100, insertions=150))

    assert result["normCer"] == pytest.approx(1.5)
    low, high = result["wilson95"]
    assert 0.0 <= low < 1.0
    assert high == pytest.approx(1.0)


def test_cluster_bootstrap_resamples_video_clusters_reproducibly():
    errors = [
        {"refChars": 100, "substitutions": 2, "deletions": 0, "insertions": 0, "clusterKey": "video-a"},
        {"refChars": 100, "substitutions": 4, "deletions": 0, "insertions": 0, "clusterKey": "video-a"},
        {"refChars": 100, "substitutions": 18, "deletions": 0, "insertions": 0, "clusterKey": "video-b"},
    ]
    first = summarize_cer_errors_with_clusters(errors, iterations=500, seed=17)
    second = summarize_cer_errors_with_clusters(errors, iterations=500, seed=17)

    assert first == second
    assert first["clusterCount"] == 2
    assert first["clusterBootstrap95"][0] <= first["normCer"] <= first["clusterBootstrap95"][1]


def test_repetition_metric_flags_repeated_asr_loop():
    looped = repetition_metrics("日本語の字幕です。" * 8)
    natural = repetition_metrics("今日はいい天気ですが、明日は雨になるそうです。")
    assert looped["repeatedNgramExcessRate"] > natural["repeatedNgramExcessRate"]
    assert looped["repeatedNgramExcessRate"] > 0.5


def test_model_summary_preserves_http_runtime_and_timestamp_metadata(tmp_path):
    import json

    manifest = {
        "windows": [
            _verified({
                "id": "a",
                "videoId": "video-a",
                "referenceHypothesis": "今日は晴れです",
                "sourceAsr": "今日は晴れ",
            }),
            _verified({
                "id": "b",
                "videoId": "video-b",
                "referenceHypothesis": "明日は雨です",
                "sourceAsr": "明日は雨です",
            }),
        ]
    }
    path = tmp_path / "manifest.json"
    path.write_text(json.dumps(manifest, ensure_ascii=False), encoding="utf-8")
    summary = evaluate_windows(
        path,
        predictions={
            "a": {
                "config": {
                    "text": "今日は晴れです",
                    "rtf": 0.25,
                    "timestampSource": "native",
                    "backend": "mlx_whisper",
                    "httpStatus": 200,
                    "coldStart": True,
                    "rssBytes": 123,
                    "metalPeakBytes": 456,
                }
            },
            "b": {
                "config": {
                    "text": "明日は雨です",
                    "rtf": 0.5,
                    "timestampSource": "native",
                    "backend": "mlx_whisper",
                    "httpStatus": 200,
                    "coldStart": False,
                    "rssBytes": 100,
                    "metalPeakBytes": 400,
                }
            }
        },
    )

    result = summary["modelEvaluations"]["config"]
    assert result["timestampCoverage"] == 1.0
    assert result["timestampsUsable"] is True
    assert result["backends"] == ["mlx_whisper"]
    assert result["httpStatuses"] == {"200": 2}
    assert result["coldStartRequests"] == 1
    assert result["maxRssBytes"] == 123
    assert result["maxMetalPeakBytes"] == 456
    assert summary["baselineYouTube"]["clusterBootstrap95"] is not None


def _model_eval(cer, ref_chars, *, rtf=0.2, timestamps=True, http="ok", categories=True):
    return {
        "normCer": cer,
        "totalRefChars": ref_chars,
        "evaluatedWindows": 4,
        "verdict": "PASS" if cer <= 0.05 else "FAIL",
        "timestampsUsable": timestamps,
        "meanRtf": rtf,
        "httpStatuses": {"200": 4} if http == "ok" else {},
        "transportErrorWindows": 0 if http == "ok" else 4,
        "contractErrorWindows": 0,
        "categoryRefChars": _full_stress_categories(ref_chars) if categories else {},
    }


def test_selects_lowest_clean_cer_after_stress_and_runtime_gates():
    clean = {
        "verifiedWindows": 4,
        "modelEvaluations": {
            "model-a [dsp_on]": _model_eval(0.04, 2400),
            "model-a [dsp_off]": _model_eval(0.041, 2400),
            "model-b [dsp_on]": _model_eval(0.035, 2400, rtf=0.8),
            "model-b [dsp_off]": _model_eval(0.035, 2400, rtf=0.9),
        },
    }
    stress = {
        "modelEvaluations": {
            "model-a [dsp_on]": _model_eval(0.05, 1200),
            "model-a [dsp_off]": _model_eval(0.051, 1200),
            "model-b [dsp_on]": _model_eval(0.07, 1200, rtf=0.8),
            "model-b [dsp_off]": _model_eval(0.07, 1200, rtf=0.9),
        },
    }

    selection = select_model_and_dsp(clean, stress)

    assert selection["winner"]["configKey"] == "model-a [dsp_on]"
    assert selection["winner"]["model"] == "model-a"
    assert selection["winner"]["dsp"] == "on"
    assert selection["verdict"] == "PASS"


def test_selection_rejects_models_without_native_timestamps():
    clean = {
        "verifiedWindows": 4,
        "modelEvaluations": {"model-a [dsp_off]": _model_eval(0.01, 2400, timestamps=False)},
    }
    stress = {"modelEvaluations": {"model-a [dsp_off]": _model_eval(0.01, 1200, timestamps=False)}}

    selection = select_model_and_dsp(clean, stress)

    assert selection["winner"] is None
    assert selection["verdict"] == "FAIL"
    assert "native timestamps" in selection["candidates"][0]["reason"]


def test_selection_parses_decode_matrix_config_fields():
    key = "model-a [dsp_on,cond_false,prompt_generic-broadcast]"
    off_key = "model-a [dsp_off,cond_false,prompt_generic-broadcast]"
    clean = {
        "modelEvaluations": {
            key: _model_eval(0.04, 2400),
            off_key: _model_eval(0.05, 2400),
        }
    }
    stress = {
        "modelEvaluations": {
            key: _model_eval(0.05, 1200),
            off_key: _model_eval(0.06, 1200),
        }
    }

    winner = select_model_and_dsp(clean, stress)["winner"]

    assert winner["model"] == "model-a"
    assert winner["dsp"] == "on"
    assert winner["conditionOnPreviousText"] is False
    assert winner["initialPromptMode"] == "generic-broadcast"


def test_selection_rejects_dsp_pair_when_dsp_on_is_worse_than_dsp_off():
    clean = {
        "verifiedWindows": 4,
        "modelEvaluations": {
            "model-a [dsp_on]": _model_eval(0.04, 2400),
            "model-a [dsp_off]": _model_eval(0.01, 2400),
        },
    }
    stress = {
        "modelEvaluations": {
            "model-a [dsp_on]": _model_eval(0.045, 1200),
            "model-a [dsp_off]": _model_eval(0.02, 1200),
        },
    }

    selection = select_model_and_dsp(clean, stress)

    assert selection["winner"] is None
    assert selection["verdict"] == "FAIL"
    assert all("DSP-on CER is worse than DSP-off" == item["reason"] for item in selection["candidates"])


def test_selection_never_uses_unverified_diagnostic_corpus():
    clean = {
        "diagnosticOnly": True,
        "verifiedWindows": 0,
        "modelEvaluations": {"model-a [dsp_on]": _model_eval(0.0, 2400)},
    }
    stress = {
        "diagnosticOnly": True,
        "verifiedWindows": 0,
        "modelEvaluations": {"model-a [dsp_on]": _model_eval(0.0, 1200)},
    }

    selection = select_model_and_dsp(clean, stress)

    assert selection["winner"] is None
    assert selection["verdict"] == "NOT_PROVEN"
    assert "unreviewed" in selection["candidates"][0]["reason"]


def test_stress_manifest_can_use_1200_character_gate(tmp_path):
    import json

    reference = "あ" * 1200
    manifest = {
        "windows": [
            _verified({
                "id": "stress-a",
                "videoId": "video-stress",
                "referenceHypothesis": reference,
                "sourceAsr": reference,
            })
        ]
    }
    path = tmp_path / "stress.json"
    path.write_text(json.dumps(manifest, ensure_ascii=False), encoding="utf-8")

    result = evaluate_windows(
        path,
        predictions={"stress-a": reference},
        min_ref_chars=MIN_STRESS_REF_CHARS,
    )["modelEvaluations"]["default"]

    assert result["totalRefChars"] == 1200
    assert result["verdict"] == "PASS"


def test_stress_manifest_reports_verified_characters_per_required_group(tmp_path):
    import json

    categories = [
        "bgm", "outro", "noise", "quiet", "dialect", "homophone",
        "multi_speaker", "multi_speaker", "multi_speaker", "multi_speaker",
    ]
    windows = []
    predictions = {}
    for index, category in enumerate(categories):
        window_id = f"stress-{index}"
        reference = "あ" * 120
        windows.append(_verified({
            "id": window_id,
            "videoId": "video-stress",
            "category": category,
            "referenceHypothesis": reference,
            "sourceAsr": reference,
        }))
        predictions[window_id] = reference
    path = tmp_path / "stress-categories.json"
    path.write_text(json.dumps({"windows": windows}, ensure_ascii=False), encoding="utf-8")

    result = evaluate_windows(
        path,
        predictions=predictions,
        min_ref_chars=MIN_STRESS_REF_CHARS,
    )["modelEvaluations"]["default"]

    assert result["categoryRefChars"] == {
        **{category: 120 for category in categories[:6]},
        "multi_speaker": 480,
    }
    assert summarize_stress_gate(result, result)["verdict"] == "PASS"


def test_stitch_transcripts_deduplicates_fuzzy_overlap():
    previous = "今日はいい天気ですね"
    current = "いい天気でしね明日は雨です"
    stitched = stitch_transcripts([previous, current])
    assert stitched.count("天気") == 1
    assert "明日は雨です" in stitched


def test_stitch_transcripts_keeps_disjoint_text():
    stitched = stitch_transcripts(["今日は晴れ", "明日は雨"])
    assert stitched == "今日は晴れ明日は雨"
