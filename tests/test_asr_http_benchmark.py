"""HTTP transport tests for the ASR benchmark harness."""

from __future__ import annotations

import json
import hashlib
from pathlib import Path
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

import pytest

from scripts import asr_http_benchmark
from scripts.asr_http_benchmark import BridgeProcess, HttpAsrClient, main, sha256_file


class _AsrHandler(BaseHTTPRequestHandler):
    requests = []
    response_text = "テストです"

    def do_POST(self):
        body = self.rfile.read(int(self.headers["Content-Length"]))
        type(self).requests.append({
            "path": self.path,
            "contentType": self.headers.get("Content-Type"),
            "bodyLength": len(body),
        })
        if self.path.startswith("/fail"):
            payload = json.dumps({"detail": "upstream failure"}).encode()
            self.send_response(500)
        else:
            payload = json.dumps({
                "text": type(self).response_text,
                "segments": [{"id": 0, "start": 0.0, "end": 1.0, "text": type(self).response_text}],
                "model": "mlx-community/test-model",
                "backend": "mlx_whisper",
                "preprocess": False,
                "durationSec": 1.0,
                "elapsedSec": 0.1,
                "rtf": 0.1,
                "rssBytes": 100,
                "metalPeakBytes": 50,
                "timestampSource": "native",
            }, ensure_ascii=False).encode()
            self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def log_message(self, format, *args):
        pass


@pytest.fixture()
def asr_server():
    _AsrHandler.requests = []
    _AsrHandler.response_text = "テストです"
    server = ThreadingHTTPServer(("127.0.0.1", 0), _AsrHandler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield f"http://127.0.0.1:{server.server_port}", _AsrHandler.requests
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)


def test_http_client_posts_raw_audio_and_preserves_backend_metadata(asr_server):
    base_url, requests = asr_server
    client = HttpAsrClient(base_url, timeout=5)

    result = client.transcribe(
        b"RIFF-test-wave",
        model="mlx-community/test-model",
        preprocess=False,
        language="ja",
    )

    assert len(requests) == 1
    assert requests[0]["bodyLength"] == len(b"RIFF-test-wave")
    assert requests[0]["contentType"] == "audio/wav"
    assert "model=mlx-community%2Ftest-model" in requests[0]["path"]
    assert "preprocess=false" in requests[0]["path"]
    assert result["httpStatus"] == 200
    assert result["backend"] == "mlx_whisper"
    assert result["timestampSource"] == "native"
    assert result["networkElapsedSec"] >= 0


def test_http_client_keeps_non_200_body_for_evidence(asr_server):
    base_url, _ = asr_server
    client = HttpAsrClient(base_url + "/fail", timeout=5)

    result = client.transcribe(b"RIFF-test-wave", model="mlx-community/test-model")

    assert result["httpStatus"] == 500
    assert result["text"] == ""
    assert result["error"] == "upstream failure"


def test_sha256_file_rejects_wrong_audio(tmp_path):
    audio = tmp_path / "slice.wav"
    audio.write_bytes(b"real audio")

    with pytest.raises(ValueError, match="SHA-256 mismatch"):
        sha256_file(audio, expected="0" * 64)


def test_bridge_process_passes_benchmark_allowlist_only_to_its_child(monkeypatch, tmp_path):
    captured = {}

    class FakeProcess:
        returncode = None

        def poll(self):
            return None

        def terminate(self):
            captured["terminated"] = True

        def wait(self, timeout=None):
            return 0

    def fake_popen(command, **kwargs):
        captured["command"] = command
        captured["env"] = kwargs["env"]
        return FakeProcess()

    monkeypatch.setattr(asr_http_benchmark.subprocess, "Popen", fake_popen)
    monkeypatch.setattr(asr_http_benchmark, "_wait_for_health", lambda *args: None)

    with BridgeProcess(
        "python",
        tmp_path / "bridge.log",
        env_overrides={asr_http_benchmark.BENCHMARK_ALLOWLIST_ENV: "1"},
    ):
        pass

    assert captured["env"][asr_http_benchmark.BENCHMARK_ALLOWLIST_ENV] == "1"
    assert captured["terminated"] is True


def test_main_passes_min_ref_chars_to_http_evaluation(asr_server, tmp_path, capsys):
    base_url, requests = asr_server
    audio = b"RIFF-test-wave"
    audio_path = tmp_path / "window.wav"
    audio_path.write_bytes(audio)
    digest = hashlib.sha256(audio).hexdigest()
    manifest = {
        "schemaVersion": 2,
        "windows": [{
            "id": "verified-window",
            "videoId": "fixture-video",
            "startMs": 0,
            "endMs": 1000,
            "durationMs": 1000,
            "referenceHypothesis": "テストです",
            "sourceAsr": "テストです",
            "audioFile": str(audio_path),
            "audioSha256": digest,
            "audioVerified": True,
            "verificationSource": "https://example.gov/transcript",
            "reviewedBy": "agent:fixture-reviewer",
            "reviewKind": "agent-official-crosscheck",
            "reviewedAt": "2026-10-29",
        }],
    }
    manifest_path = tmp_path / "manifest.json"
    manifest_path.write_text(json.dumps(manifest), encoding="utf-8")
    output_path = tmp_path / "summary.json"

    exit_code = main([
        "--manifest", str(manifest_path),
        "--bridge-url", base_url,
        "--models", "mlx-community/test-model",
        "--initial-prompt", "固定プロンプト",
        "--min-ref-chars", "1",
        "--streaming",
        "--json-out", str(output_path),
    ])

    assert exit_code == 0
    assert len(requests) == 1
    assert parse_qs(urlparse(requests[0]["path"]).query)["initial_prompt"] == ["固定プロンプト"]
    summary = json.loads(output_path.read_text(encoding="utf-8"))
    assert summary["streaming"] is True
    assert summary["modelEvaluations"]["mlx-community/test-model [dsp_on]"]["verdict"] == "PASS"


def test_main_runs_full_decode_matrix_without_switching_model_loads(asr_server, tmp_path):
    base_url, requests = asr_server
    audio = b"RIFF-test-wave"
    audio_path = tmp_path / "window.wav"
    audio_path.write_bytes(audio)
    digest = hashlib.sha256(audio).hexdigest()
    manifest = {
        "schemaVersion": 2,
        "windows": [{
            "id": "verified-window",
            "videoId": "fixture-video",
            "startMs": 0,
            "endMs": 1000,
            "durationMs": 1000,
            "referenceHypothesis": "テストです",
            "sourceAsr": "テストです",
            "audioFile": str(audio_path),
            "audioSha256": digest,
            "audioVerified": True,
            "verificationSource": "https://example.gov/transcript",
            "reviewedBy": "agent:fixture-reviewer",
            "reviewKind": "agent-official-crosscheck",
            "reviewedAt": "2026-10-29",
        }],
    }
    manifest_path = tmp_path / "manifest.json"
    manifest_path.write_text(json.dumps(manifest), encoding="utf-8")
    output_path = tmp_path / "summary.json"

    exit_code = main([
        "--manifest", str(manifest_path),
        "--bridge-url", base_url,
        "--models", "mlx-community/test-model",
        "--compare-dsp",
        "--decode-matrix",
        "--min-ref-chars", "1",
        "--json-out", str(output_path),
    ])

    assert exit_code == 0
    assert len(requests) == 8
    assert any("condition_on_previous_text=false" in request["path"] for request in requests)
    assert any("condition_on_previous_text=true" in request["path"] for request in requests)
    assert any("initial_prompt=" in request["path"] for request in requests)
    summary = json.loads(output_path.read_text(encoding="utf-8"))
    assert len(summary["modelEvaluations"]) == 8
    assert summary["runMetadata"]["decodeMatrix"] == [
        {"conditionOnPreviousText": False, "initialPromptMode": "none", "initialPrompt": None},
        {
            "conditionOnPreviousText": False,
            "initialPromptMode": "generic-broadcast",
            "initialPrompt": asr_http_benchmark.GENERIC_BROADCAST_INITIAL_PROMPT,
        },
        {"conditionOnPreviousText": True, "initialPromptMode": "none", "initialPrompt": None},
        {
            "conditionOnPreviousText": True,
            "initialPromptMode": "generic-broadcast",
            "initialPrompt": asr_http_benchmark.GENERIC_BROADCAST_INITIAL_PROMPT,
        },
    ]


def test_rolling_context_uses_decoded_text_and_resets_on_gap_or_video_boundary(
    asr_server, tmp_path
):
    base_url, requests = asr_server
    windows = []
    for window_id, video_id, start_ms, end_ms in (
        ("window-1", "video-a", 0, 1000),
        ("window-2", "video-a", 600, 1600),
        ("window-3", "video-a", 3000, 4000),
        ("window-4", "video-b", 0, 1000),
        ("window-5", "video-a", 3500, 4500),
    ):
        audio_path = tmp_path / f"{window_id}.wav"
        audio_path.write_bytes(b"RIFF-test-wave")
        windows.append({
            "id": window_id,
            "videoId": video_id,
            "startMs": start_ms,
            "endMs": end_ms,
            "durationMs": end_ms - start_ms,
            "referenceHypothesis": f"REFERENCE-{window_id}",
            "streamReference": f"REFERENCE-{window_id}",
            "sourceAsr": f"REFERENCE-{window_id}",
            "audioFile": str(audio_path),
            "audioSha256": hashlib.sha256(b"RIFF-test-wave").hexdigest(),
            "audioVerified": True,
            "verificationSource": "https://example.gov/transcript",
            "reviewedBy": "agent:fixture-reviewer",
            "reviewKind": "agent-official-crosscheck",
            "reviewedAt": "2026-10-29",
        })
    manifest_path = tmp_path / "manifest.json"
    manifest_path.write_text(
        json.dumps({"schemaVersion": 2, "windows": windows}), encoding="utf-8"
    )

    output_path = tmp_path / "summary.json"
    exit_code = main([
        "--manifest", str(manifest_path),
        "--bridge-url", base_url,
        "--models", "mlx-community/test-model",
        "--rolling-context",
        "--initial-prompt", "",
        "--min-ref-chars", "1",
        "--json-out", str(output_path),
    ])

    assert exit_code == 0
    queries = [parse_qs(urlparse(request["path"]).query) for request in requests]
    prompts = [query.get("initial_prompt") for query in queries]
    assert prompts == [None, ["テストです"], None, None, None]
    assert all("REFERENCE" not in request["path"] for request in requests)
    metadata = json.loads(output_path.read_text(encoding="utf-8"))["runMetadata"]
    assert metadata["rollingContext"] is True
    assert metadata["decodeMatrix"] == [{
        "conditionOnPreviousText": False,
        "initialPromptMode": "rolling-context",
        "initialPrompt": None,
    }]


def test_rolling_context_is_capped_to_previous_200_characters(asr_server, tmp_path):
    base_url, requests = asr_server
    _AsrHandler.response_text = "先" * 250
    windows = []
    for window_id, start_ms, end_ms in (
        ("window-1", 0, 1000),
        ("window-2", 600, 1600),
    ):
        audio_path = tmp_path / f"{window_id}.wav"
        audio_path.write_bytes(b"RIFF-test-wave")
        windows.append({
            "id": window_id,
            "videoId": "video-a",
            "startMs": start_ms,
            "endMs": end_ms,
            "durationMs": end_ms - start_ms,
            "referenceHypothesis": f"REFERENCE-{window_id}",
            "streamReference": f"REFERENCE-{window_id}",
            "sourceAsr": f"REFERENCE-{window_id}",
            "audioFile": str(audio_path),
            "audioSha256": hashlib.sha256(b"RIFF-test-wave").hexdigest(),
            "audioVerified": True,
            "verificationSource": "https://example.gov/transcript",
            "reviewedBy": "agent:fixture-reviewer",
            "reviewKind": "agent-official-crosscheck",
            "reviewedAt": "2026-10-29",
        })
    manifest_path = tmp_path / "manifest.json"
    manifest_path.write_text(
        json.dumps({"schemaVersion": 2, "windows": windows}), encoding="utf-8"
    )

    exit_code = main([
        "--manifest", str(manifest_path),
        "--bridge-url", base_url,
        "--models", "mlx-community/test-model",
        "--rolling-context",
        "--initial-prompt", "",
        "--min-ref-chars", "1",
    ])

    assert exit_code == 0
    queries = [parse_qs(urlparse(request["path"]).query) for request in requests]
    prompts = [query.get("initial_prompt") for query in queries]
    assert prompts[0] is None
    assert prompts[1] == ["先" * 200]
