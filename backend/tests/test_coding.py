"""Tests for the V1 coding-practice platform.

Covers:
- Seed loads on first read.
- List filters (difficulty + status).
- Problem detail redacts hidden tests + reference solution until solved.
- Runner endpoint exposes hidden tests.
- Submit happy path: records submission, bumps mastery, awards XP on first AC.
- Repeat AC is idempotent (no double mastery / XP).
- Failed submissions never bump.
- Role guard: only students can call /coding.
"""
from __future__ import annotations


# ────────────────────────────────────────────────────────────────
# Helpers
# ────────────────────────────────────────────────────────────────


def _student_headers(client, signup_payload) -> tuple[dict, dict]:
    r = client.post("/api/v1/auth/signup", json=signup_payload("student"))
    assert r.status_code in (200, 201), r.text
    body = r.json()
    return {"Authorization": f"Bearer {body['access_token']}"}, body["user"]


def _teacher_headers(client, signup_payload) -> dict:
    r = client.post("/api/v1/auth/signup", json=signup_payload("teacher"))
    assert r.status_code in (200, 201)
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


# ────────────────────────────────────────────────────────────────
# List + seed
# ────────────────────────────────────────────────────────────────


def test_list_problems_seeds_on_first_read(client, signup_payload):
    headers, _ = _student_headers(client, signup_payload)
    r = client.get("/api/v1/coding/problems", headers=headers)
    assert r.status_code == 200, r.text
    body = r.json()
    # All five seeded problems land on first read.
    assert len(body) == 5
    slugs = {p["slug"] for p in body}
    assert {
        "two-sum",
        "valid-palindrome",
        "valid-parentheses",
        "maximum-subarray",
        "container-with-most-water",
    } <= slugs
    # Default per-user status is unsolved.
    assert all(p["user_status"] == "unsolved" for p in body)


def test_list_filter_by_difficulty(client, signup_payload):
    headers, _ = _student_headers(client, signup_payload)
    # Trigger seed
    client.get("/api/v1/coding/problems", headers=headers)
    r = client.get("/api/v1/coding/problems?difficulty=easy", headers=headers)
    assert r.status_code == 200
    body = r.json()
    assert all(p["difficulty"] == "easy" for p in body)
    # 3 easies seeded: two-sum, valid-palindrome, valid-parentheses
    assert len(body) == 3


def test_list_filter_by_topic(client, signup_payload):
    headers, _ = _student_headers(client, signup_payload)
    client.get("/api/v1/coding/problems", headers=headers)
    # "Arrays" appears on two-sum + maximum-subarray + container-with-most-water
    r = client.get("/api/v1/coding/problems?topic=Arrays", headers=headers)
    assert r.status_code == 200
    body = r.json()
    slugs = {p["slug"] for p in body}
    assert slugs == {"two-sum", "maximum-subarray", "container-with-most-water"}


# ────────────────────────────────────────────────────────────────
# Detail
# ────────────────────────────────────────────────────────────────


def test_get_problem_detail_shape(client, signup_payload):
    headers, _ = _student_headers(client, signup_payload)
    client.get("/api/v1/coding/problems", headers=headers)  # seed
    r = client.get("/api/v1/coding/problems/two-sum", headers=headers)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["slug"] == "two-sum"
    assert body["function_name"] == "two_sum"
    assert body["comparator"] == "sorted"
    assert len(body["visible_test_cases"]) >= 1
    # Hidden tests must NOT leak through the detail endpoint.
    assert "hidden_test_cases" not in body
    # Reference solution hidden until AC.
    assert body["reference_solution"] is None


def test_get_problem_404_for_unknown_slug(client, signup_payload):
    headers, _ = _student_headers(client, signup_payload)
    client.get("/api/v1/coding/problems", headers=headers)
    r = client.get("/api/v1/coding/problems/does-not-exist", headers=headers)
    assert r.status_code == 404


# ────────────────────────────────────────────────────────────────
# Runner endpoint
# ────────────────────────────────────────────────────────────────


def test_runner_endpoint_exposes_all_test_cases(client, signup_payload):
    headers, _ = _student_headers(client, signup_payload)
    client.get("/api/v1/coding/problems", headers=headers)
    r = client.get("/api/v1/coding/problems/two-sum/runner", headers=headers)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["function_name"] == "two_sum"
    assert body["comparator"] == "sorted"
    # Visible + hidden are both present here (deliberate).
    assert len(body["visible_test_cases"]) >= 3
    assert len(body["hidden_test_cases"]) >= 3


# ────────────────────────────────────────────────────────────────
# Submit happy path
# ────────────────────────────────────────────────────────────────


def _submit(client, headers, slug: str, *, status: str, passed: int, total: int):
    return client.post(
        f"/api/v1/coding/problems/{slug}/submit",
        headers=headers,
        json={
            "language": "python",
            "code": "def two_sum(nums, target):\n    return [0, 1]\n",
            "status": status,
            "passed_count": passed,
            "total_count": total,
            "runtime_ms": 42,
            "error_message": None,
        },
    )


def test_submit_first_ac_records_and_returns_first_solve(client, signup_payload):
    headers, _ = _student_headers(client, signup_payload)
    client.get("/api/v1/coding/problems", headers=headers)  # seed
    r = _submit(client, headers, "two-sum", status="passed", passed=8, total=8)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["first_solve"] is True
    assert body["xp_earned"] > 0
    assert body["submission"]["status"] == "passed"
    assert body["submission"]["passed_count"] == 8
    # Problem now shows as solved.
    list_resp = client.get("/api/v1/coding/problems", headers=headers).json()
    two_sum_row = next(p for p in list_resp if p["slug"] == "two-sum")
    assert two_sum_row["user_status"] == "solved"


def test_submit_first_ac_unlocks_reference_solution(client, signup_payload):
    headers, _ = _student_headers(client, signup_payload)
    client.get("/api/v1/coding/problems", headers=headers)
    _submit(client, headers, "two-sum", status="passed", passed=8, total=8)
    detail = client.get("/api/v1/coding/problems/two-sum", headers=headers).json()
    assert detail["reference_solution"] is not None
    assert "python" in detail["reference_solution"]


def test_submit_first_ac_declares_skill(client, signup_payload, db_session):
    """First AC should add the problem's skill_node_names to the student's
    profile.skills JSON list (V1 mastery mechanism — V3 will graduate this)."""
    import uuid as _uuid
    from app.models.user import User as UserModel

    headers, user = _student_headers(client, signup_payload)
    client.get("/api/v1/coding/problems", headers=headers)
    _submit(client, headers, "two-sum", status="passed", passed=8, total=8)

    db_user = db_session.get(UserModel, _uuid.UUID(user["id"]))
    assert db_user is not None
    assert db_user.student_profile is not None
    declared = [str(s).lower() for s in (db_user.student_profile.skills or [])]
    assert "arrays" in declared
    assert "hashing" in declared


def test_submit_repeat_ac_does_not_double_award(client, signup_payload):
    headers, _ = _student_headers(client, signup_payload)
    client.get("/api/v1/coding/problems", headers=headers)
    first = _submit(client, headers, "two-sum", status="passed", passed=8, total=8).json()
    second = _submit(client, headers, "two-sum", status="passed", passed=8, total=8).json()
    assert first["first_solve"] is True
    assert second["first_solve"] is False
    assert second["xp_earned"] == 0
    # Second submission is recorded in history.
    history = client.get(
        "/api/v1/coding/problems/two-sum/submissions", headers=headers
    ).json()
    assert len(history) == 2


def test_submit_failed_does_not_award_xp(client, signup_payload):
    headers, _ = _student_headers(client, signup_payload)
    client.get("/api/v1/coding/problems", headers=headers)
    r = _submit(client, headers, "two-sum", status="failed", passed=3, total=8)
    assert r.status_code == 200
    body = r.json()
    assert body["first_solve"] is False
    assert body["xp_earned"] == 0
    # Still recorded — just doesn't count.
    history = client.get(
        "/api/v1/coding/problems/two-sum/submissions", headers=headers
    ).json()
    assert len(history) == 1
    # And the list view shows "attempted".
    listing = client.get("/api/v1/coding/problems", headers=headers).json()
    two_sum_row = next(p for p in listing if p["slug"] == "two-sum")
    assert two_sum_row["user_status"] == "attempted"


def test_submit_rejects_passed_count_over_total(client, signup_payload):
    headers, _ = _student_headers(client, signup_payload)
    client.get("/api/v1/coding/problems", headers=headers)
    r = _submit(client, headers, "two-sum", status="passed", passed=10, total=8)
    assert r.status_code == 400


# ────────────────────────────────────────────────────────────────
# Stats + role guard
# ────────────────────────────────────────────────────────────────


def test_stats_reflects_solved_counts(client, signup_payload):
    headers, _ = _student_headers(client, signup_payload)
    client.get("/api/v1/coding/problems", headers=headers)  # seed
    # Solve one easy + one medium
    _submit(client, headers, "two-sum", status="passed", passed=8, total=8)
    _submit(client, headers, "maximum-subarray", status="passed", passed=8, total=8)
    r = client.get("/api/v1/coding/stats", headers=headers)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["solved_easy"] == 1
    assert body["solved_medium"] == 1
    assert body["solved_hard"] == 0
    assert body["total_problems"] == 5
    assert body["total_submissions"] == 2


def test_teacher_blocked_from_coding(client, signup_payload):
    headers = _teacher_headers(client, signup_payload)
    r = client.get("/api/v1/coding/problems", headers=headers)
    assert r.status_code == 403
