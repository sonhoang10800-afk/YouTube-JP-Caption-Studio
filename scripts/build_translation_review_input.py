#!/usr/bin/env python3
"""Build an independent-review input from a live Gemini translation run."""

from __future__ import annotations

import argparse
import json
from pathlib import Path


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--live-stdout", type=Path, required=True)
    parser.add_argument("--prompt-version", type=int, required=True)
    parser.add_argument("--out", type=Path, required=True)
    return parser.parse_args()


def result_map(run: dict, language: str, expected_ids: set[str]) -> dict[str, dict]:
    results = run["languages"][language]["fresh"]
    suffix = f"-{language}"
    mapped: dict[str, dict] = {}
    for result in results:
        cue_id = result["id"]
        if not cue_id.endswith(suffix):
            raise ValueError(f"unexpected {language} result id: {cue_id}")
        cue_id = cue_id[: -len(suffix)]
        if cue_id in mapped:
            raise ValueError(f"duplicate {language} result id: {cue_id}")
        mapped[cue_id] = result
    if set(mapped) != expected_ids:
        missing = sorted(expected_ids - set(mapped))
        extra = sorted(set(mapped) - expected_ids)
        raise ValueError(f"{language} result mismatch: missing={missing}, extra={extra}")
    if any(result.get("status") != "ready" for result in mapped.values()):
        raise ValueError(f"{language} contains non-ready results")
    return mapped


def main() -> int:
    args = parse_args()
    manifest = json.loads(args.manifest.read_text(encoding="utf-8"))
    run = json.loads(args.live_stdout.read_text(encoding="utf-8"))
    cues = manifest["cues"]
    expected_ids = {cue["id"] for cue in cues}
    mapped = {language: result_map(run, language, expected_ids) for language in ("vi", "en")}

    review_cues = []
    for index, cue in enumerate(cues):
        entry = {
            "id": cue["id"],
            "source": cue["source"],
            "referenceEn": cue["referenceEn"],
            "reviewRequirement": cue["reviewRequirement"],
            "context": cues[index - 1]["source"][-300:] if index else "",
        }
        for language in ("vi", "en"):
            result = mapped[language][cue["id"]]
            entry[language] = {"text": result["text"], "model": result.get("model")}
        review_cues.append(entry)

    run_summary = {}
    for language in ("vi", "en"):
        language_run = run["languages"][language]
        cached = language_run["cached"]
        fresh = [mapped[language][cue["id"]]["text"] for cue in cues]
        run_summary[language] = {
            "freshReady": len(fresh),
            "freshFailed": len(run["languages"][language]["fresh"]) - len(fresh),
            "cacheIdentical": cached == fresh,
            "revisionReady": bool(language_run["revision"]),
            "revisionBypassedCache": bool(language_run["revision"])
            and not bool(language_run["revision"][0].get("cached")),
        }

    output = {
        "provenance": {
            "purpose": f"Independent rubric review input for PROMPT_VERSION {args.prompt_version} live Gemini output",
            "manifest": str(args.manifest),
            "liveStdout": str(args.live_stdout),
            "machineVerifiedOnly": True,
            "humanApproval": False,
            "runSummary": run_summary,
            "missingKey": run["missingKey"],
            "dummyKey": run["dummyKey"],
        },
        "rubric": {
            "fields": ["meaning", "naturalness", "fidelity", "format"],
            "scale": "0-2",
            "pass": "every field equals 2",
        },
        "cues": review_cues,
    }
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(output, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    args.out.chmod(0o600)
    print(json.dumps({"out": str(args.out), "cues": len(review_cues), "runSummary": run_summary}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
