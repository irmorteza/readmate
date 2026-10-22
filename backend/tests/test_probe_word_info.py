import json
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "scripts"))
import probe_word_info  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
LANGUAGE_CODES = [
    x["code"]
    for x in json.loads((ROOT / "contract/languages.json").read_text(encoding="utf-8"))["languages"]
]


def ok_row(stops, tokens, cached=False, **extra):
    body = {
        "word": "stellte",
        "lemma": "vorstellen",
        "translation": "introduced",
        "separableVerb": {"infinitive": "vorstellen", "wordIndexes": [1, 5]},
        "expression": None,
        "meta": {
            "cached": cached,
            "latencyMs": 900,
            "stopReasons": stops,
            "outputTokens": tokens,
        },
    }
    body.update(extra)
    return {"name": "case", "status": 200, "body": body}


def error_row(stops, tokens):
    body = {
        "error": {
            "code": "LOOKUP_FAILED",
            "message": "failed",
            "stopReasons": stops,
            "outputTokens": tokens,
        }
    }
    return {"name": "bad", "status": 502, "body": body}


def four_rows():
    return [
        ok_row([], [], cached=True),
        ok_row(["max_tokens", "end_turn"], [1500, 400]),
        error_row(["max_tokens", "max_tokens"], [1500, 1500]),
        ok_row(["end_turn"], [1300]),
    ]


def test_summarize_counts_calls_and_excludes_cached_hits():
    assert probe_word_info.summarize(four_rows()) == {
        "calls": 5,
        "max_tokens_stops": 3,
        "other_stops": 0,
        "max_output_tokens": 1500,
        "median_output_tokens": 1500,
        "calls_over_1200": 4,
    }


def test_summarize_counts_other_stops_and_handles_no_calls():
    rows = [ok_row(["refusal", "end_turn"], [100, 200])]
    summary = probe_word_info.summarize(rows)
    assert summary["other_stops"] == 1 and summary["max_tokens_stops"] == 0
    empty = probe_word_info.summarize([ok_row([], [], cached=True)])
    assert empty["calls"] == 0 and empty["max_output_tokens"] == 0


def test_format_row_shows_status_cached_pairs_lemma_and_groups():
    line = probe_word_info.format_row(ok_row(["max_tokens", "end_turn"], [1500, 400]))
    assert "200" in line and "cached=False" in line
    assert "max_tokens:1500" in line and "end_turn:400" in line
    assert "vorstellen" in line and "[1, 5]" in line


def test_format_row_cached_says_no_model_call():
    line = probe_word_info.format_row(ok_row([], [], cached=True))
    assert "cached — no model call" in line


def test_format_row_for_an_error_shows_status_and_code():
    line = probe_word_info.format_row(error_row(["max_tokens"], [1500]))
    assert "502" in line and "LOOKUP_FAILED" in line and "max_tokens:1500" in line


def test_cases_are_well_formed():
    cases = probe_word_info.CASES
    assert len(cases) == 26
    adjective = next(c for c in cases if c["name"] == "adjective after a verb")
    assert adjective["words"] == ["Das", "Wasser", "ist", "klar."] and adjective["wordIndex"] == 3
    for case in cases:
        assert set(case) >= {"name", "word", "wordIndex", "kind", "words", "target", "expect"}
        assert case["words"][case["wordIndex"]].strip(".,") == case["word"].strip(".,")
        assert case["kind"] in {"sentence", "fragment", "incomplete"}
        assert case["target"] in LANGUAGE_CODES
    assert len({c["name"] for c in cases}) == 26


def test_every_listed_target_has_a_case():
    assert {c["target"] for c in probe_word_info.CASES} == set(LANGUAGE_CODES)


def test_backlog_cases_carry_expectations():
    by_name = {c["name"]: c for c in probe_word_info.CASES}
    assert by_name["separable, adjacent at line end"]["expect"] == {
        "expression": None,
        "lemma": "vorstellen",
    }
    assert by_name["tap the particle"]["expect"] == {"lemma": "anrufen"}
    assert by_name["tap the particle vor"]["expect"] == {"lemma": "vorstellen"}
    assert by_name["tap the particle ankommen"]["expect"] == {"lemma": "ankommen"}


def test_check_expect():
    row = ok_row(["end_turn"], [400])
    assert probe_word_info.check_expect(row, {"lemma": "vorstellen"}) == []
    assert probe_word_info.check_expect(row, {}) == []
    assert probe_word_info.check_expect(row, None) == []
    assert probe_word_info.check_expect(row, {"lemma": "anrufen"}) == ["lemma"]
    assert probe_word_info.check_expect(row, {"separableVerb": None}) == ["separableVerb"]
    assert probe_word_info.check_expect(row, {"expression": None}) == []
    bad = error_row(["max_tokens"], [1500])
    assert probe_word_info.check_expect(bad, {"lemma": "x"}) == ["(no answer)"]
    assert probe_word_info.check_expect(bad, {}) == []


def test_summarize_by_target_excludes_cached_rows():
    rows = [
        {**ok_row(["end_turn"], [400]), "target": "en"},
        {**ok_row(["end_turn"], [600]), "target": "fa"},
        {**ok_row(["end_turn"], [800]), "target": "fa"},
        {**ok_row([], [], cached=True), "target": "fa"},
    ]
    assert probe_word_info.summarize_by_target(rows) == {
        "en": {"calls": 1, "median_output_tokens": 400, "max_output_tokens": 400},
        "fa": {"calls": 2, "median_output_tokens": 700, "max_output_tokens": 800},
    }


def test_format_row_shows_target_and_expectation_result():
    row = {**ok_row(["end_turn"], [400]), "target": "fa"}
    assert "target=fa" in probe_word_info.format_row(row)
    assert "expect OK" in probe_word_info.format_row(row, {"lemma": "vorstellen"})
    assert "expect FAIL lemma" in probe_word_info.format_row(row, {"lemma": "x"})
    assert "expect" not in probe_word_info.format_row(row)


class Api:
    def __init__(self, status, body):
        self.requests = []
        api = self

        class Handler(BaseHTTPRequestHandler):
            def do_POST(self):
                length = int(self.headers.get("Content-Length") or 0)
                api.requests.append(
                    (self.path, dict(self.headers), json.loads(self.rfile.read(length)))
                )
                payload = json.dumps(body).encode()
                self.send_response(status)
                self.send_header("Content-Length", str(len(payload)))
                self.end_headers()
                self.wfile.write(payload)

            def log_message(self, *args):
                pass

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        self.url = f"http://127.0.0.1:{self.server.server_address[1]}/"

    def close(self):
        self.server.shutdown()
        self.server.server_close()


@pytest.fixture
def api_factory():
    created = []

    def make(status, body):
        api = Api(status, body)
        created.append(api)
        return api

    yield make
    for api in created:
        api.close()


def test_run_case_parses_a_200(api_factory):
    canned = ok_row(["end_turn"], [400])["body"]
    api = api_factory(200, canned)
    case = probe_word_info.CASES[0]
    row = probe_word_info.run_case(api.url, "tok", case, timeout=3.0)
    assert row["status"] == 200 and row["name"] == case["name"]
    assert row["body"]["meta"]["outputTokens"] == [400]
    path, headers, sent = api.requests[0]
    assert path == "/v1/word-info"
    assert headers["X-Pilot-Token"] == "tok"
    assert sent["word"] == case["word"] and sent["wordIndex"] == case["wordIndex"]
    assert sent["sentence"] == {"kind": case["kind"], "words": case["words"]}
    assert sent["target"] == case["target"] == "en"


def test_run_case_parses_a_502(api_factory):
    canned = error_row(["max_tokens"], [1500])["body"]
    api = api_factory(502, canned)
    row = probe_word_info.run_case(api.url, "tok", probe_word_info.CASES[0], timeout=3.0)
    assert row["status"] == 502
    assert row["body"]["error"]["stopReasons"] == ["max_tokens"]


def test_run_case_unreachable_gives_status_zero():
    row = probe_word_info.run_case(
        "http://127.0.0.1:1/", "tok", probe_word_info.CASES[0], timeout=1.0
    )
    assert row["status"] == 0


def test_main_prompts_for_the_token_and_prints_summary_and_verdict(
    api_factory, monkeypatch, capsys
):
    api = api_factory(200, ok_row(["end_turn"], [400])["body"])
    prompts = []
    monkeypatch.setattr(
        probe_word_info.getpass, "getpass", lambda prompt="": prompts.append(prompt) or "sekret"
    )
    code = probe_word_info.main(["--api-url", api.url])
    out = capsys.readouterr().out
    assert code == 0
    assert prompts == ["Pilot token: "]
    assert "sekret" not in out
    assert "max_tokens OK" in out
    assert out.count("\n") >= 12 + 2


def test_main_verdict_asks_for_review_on_max_tokens(api_factory, monkeypatch, capsys):
    api = api_factory(200, ok_row(["max_tokens"], [1500])["body"])
    monkeypatch.setattr(probe_word_info.getpass, "getpass", lambda prompt="": "t")
    probe_word_info.main(["--api-url", api.url])
    assert "REVIEW max_tokens/effort" in capsys.readouterr().out


def test_main_has_no_token_argument():
    with pytest.raises(SystemExit):
        probe_word_info.main(["--api-url", "http://x/", "--token", "abc"])
