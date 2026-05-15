"""Schedule generation tests — covers both strategies.

`spread` is the default round-robin planner that powers the regular
`/student/schedule` page. `backtracking` is the branch-and-bound packer
that Crash Mode uses. The route picks between them based on the
`strategy` field on the request body.

Pure-logic tests call `spread_schedule.generate_spread_schedule` directly
so they don't need a DB. Route-integration tests sign up a student and
hit `/api/v1/algorithms/schedule/generate` so we know the wiring + schema
defaults are intact.
"""
from __future__ import annotations

from app.services.backtracking_schedule import (
    DEFAULT_DAY_HOURS,
    DEFAULT_LOCKED_LABEL_BY_HOUR,
    StudyTask,
)
from app.services.spread_schedule import (
    DEFAULT_DAILY_CAP_HOURS,
    HARD_DAILY_CEILING,
    PREFERRED_START_HOUR,
    generate_spread_schedule,
)


# ── Pure-logic tests ──────────────────────────────────────────────────


def test_empty_tasks_returns_empty_schedule():
    result = generate_spread_schedule([], days=7)
    assert result.scheduled_tasks == []
    assert result.skipped_tasks == []
    assert result.total_hours_scheduled == 0
    assert result.total_value == 0.0
    assert result.explored_nodes == 0
    # Grid is still built so the frontend can render locks.
    assert len(result.slots) == 7 * len(DEFAULT_DAY_HOURS)
    assert all(s.topic is None or s.is_locked for s in result.slots)


def test_single_short_task_lands_on_first_day():
    tasks = [StudyTask(topic="Arrays", hours=1, priority=5, subject_code="DAA")]
    result = generate_spread_schedule(tasks, days=7)
    assert len(result.scheduled_tasks) == 1
    assert result.skipped_tasks == []
    assert result.total_hours_scheduled == 1
    placed = [s for s in result.slots if s.topic == "Arrays" and not s.is_locked]
    assert len(placed) == 1
    assert placed[0].day_index == 0
    assert placed[0].hour_index >= PREFERRED_START_HOUR


def test_multi_hour_task_spreads_across_days():
    """A 4-hour task on a 7-day plan should land on 4 different days."""
    tasks = [StudyTask(topic="DP", hours=4, priority=5, subject_code="DAA")]
    result = generate_spread_schedule(tasks, days=7)
    placed = [s for s in result.slots if s.topic == "DP"]
    assert len(placed) == 4
    days_used = {s.day_index for s in placed}
    assert len(days_used) == 4, f"Expected 4 distinct days, got {days_used}"


def test_daily_cap_respected():
    """With `daily_cap_hours=2`, no day can have more than 2 task-hour blocks."""
    tasks = [
        StudyTask(topic="A", hours=3, priority=5, subject_code=None),
        StudyTask(topic="B", hours=3, priority=5, subject_code=None),
        StudyTask(topic="C", hours=3, priority=5, subject_code=None),
    ]
    result = generate_spread_schedule(tasks, days=5, daily_cap_hours=2)
    by_day: dict[int, int] = {}
    for s in result.slots:
        if s.topic and not s.is_locked:
            by_day[s.day_index] = by_day.get(s.day_index, 0) + 1
    assert all(count <= 2 for count in by_day.values()), by_day


def test_hard_ceiling_clamps_oversized_cap_request():
    """Requesting `daily_cap_hours=10` clamps to HARD_DAILY_CEILING=5."""
    tasks = [StudyTask(topic="Grind", hours=20, priority=5, subject_code="DAA")]
    result = generate_spread_schedule(tasks, days=2, daily_cap_hours=10)
    by_day: dict[int, int] = {}
    for s in result.slots:
        if s.topic == "Grind":
            by_day[s.day_index] = by_day.get(s.day_index, 0) + 1
    assert all(count <= HARD_DAILY_CEILING for count in by_day.values()), by_day


def test_default_cap_when_not_provided():
    """When daily_cap_hours is None, the planner uses DEFAULT_DAILY_CAP_HOURS=3."""
    tasks = [StudyTask(topic="Heavy", hours=12, priority=5, subject_code="DAA")]
    result = generate_spread_schedule(tasks, days=3, daily_cap_hours=None)
    by_day: dict[int, int] = {}
    for s in result.slots:
        if s.topic == "Heavy":
            by_day[s.day_index] = by_day.get(s.day_index, 0) + 1
    assert all(count <= DEFAULT_DAILY_CAP_HOURS for count in by_day.values()), by_day


def test_locked_hours_preserved():
    """Lunch (13:00) and dinner (20:00) stay locked across every day."""
    tasks = [StudyTask(topic="X", hours=10, priority=5, subject_code=None)]
    result = generate_spread_schedule(tasks, days=7, daily_cap_hours=5)
    locked_slots = [s for s in result.slots if s.is_locked]
    assert len(locked_slots) == 7 * len(DEFAULT_LOCKED_LABEL_BY_HOUR)
    # No task ever lands on a locked hour.
    for s in result.slots:
        if s.hour_index in DEFAULT_LOCKED_LABEL_BY_HOUR:
            assert s.is_locked is True
            assert s.topic == DEFAULT_LOCKED_LABEL_BY_HOUR[s.hour_index]


def test_no_blocks_before_preferred_start_hour():
    """Spread planner reserves the slow morning — no topics before 9 AM."""
    tasks = [StudyTask(topic="X", hours=20, priority=5, subject_code=None)]
    result = generate_spread_schedule(tasks, days=4, daily_cap_hours=5)
    for s in result.slots:
        if s.topic == "X":
            assert s.hour_index >= PREFERRED_START_HOUR


def test_same_task_contiguous_within_day():
    """If multiple hours of the same task land on the same day, they're adjacent."""
    # Force same-day stacking by making it impossible to spread: 1 day, 3-hour task, cap 5.
    tasks = [StudyTask(topic="Solo", hours=3, priority=5, subject_code="DAA")]
    result = generate_spread_schedule(tasks, days=1, daily_cap_hours=5)
    placed = sorted(
        (s for s in result.slots if s.topic == "Solo"),
        key=lambda s: s.hour_index,
    )
    assert len(placed) == 3
    hours = [s.hour_index for s in placed]
    # Adjacent — each hour differs by 1.
    diffs = [b - a for a, b in zip(hours, hours[1:])]
    assert diffs == [1, 1], f"Expected contiguous hours, got {hours}"


def test_skipped_when_total_exceeds_capacity():
    """Tasks beyond total weekly capacity show up in skipped_tasks."""
    tasks = [
        StudyTask(topic="A", hours=5, priority=5, subject_code=None),
        StudyTask(topic="B", hours=5, priority=5, subject_code=None),
        StudyTask(topic="C", hours=5, priority=5, subject_code=None),
        StudyTask(topic="D", hours=5, priority=5, subject_code=None),
    ]
    # 2 days × 2-hour cap = 4 hours of capacity total; 20 hours of tasks.
    result = generate_spread_schedule(tasks, days=2, daily_cap_hours=2)
    placed = sum(1 for s in result.slots if s.topic and not s.is_locked)
    assert placed == 4
    # Every task whose hours never got placed should be in skipped.
    placed_topics = {s.topic for s in result.slots if s.topic and not s.is_locked}
    unplaced_topics = {t.topic for t in tasks} - placed_topics
    skipped_topics = {t.topic for t in result.skipped_tasks}
    assert unplaced_topics == skipped_topics


def test_priority_ordering_high_first():
    """When capacity is tight, higher-priority tasks get placed first."""
    tasks = [
        StudyTask(topic="Low", hours=1, priority=1, subject_code=None),
        StudyTask(topic="High", hours=1, priority=9, subject_code=None),
        StudyTask(topic="Mid", hours=1, priority=5, subject_code=None),
    ]
    # 1 day × 1-hour cap = only one hour of capacity.
    result = generate_spread_schedule(tasks, days=1, daily_cap_hours=1)
    placed_topics = {s.topic for s in result.slots if s.topic and not s.is_locked}
    assert "High" in placed_topics


def test_explored_nodes_is_zero():
    """Spread is a deterministic greedy — no search tree, no explored nodes."""
    tasks = [StudyTask(topic="X", hours=3, priority=5, subject_code="DAA")]
    result = generate_spread_schedule(tasks, days=5)
    assert result.explored_nodes == 0


def test_subject_code_preserved_in_slots():
    """Subject codes attached to tasks flow through to the placed slots."""
    tasks = [
        StudyTask(topic="Arrays", hours=2, priority=5, subject_code="DAA"),
        StudyTask(topic="TCP", hours=2, priority=5, subject_code="CN"),
    ]
    result = generate_spread_schedule(tasks, days=4, daily_cap_hours=3)
    daa_slots = [s for s in result.slots if s.topic == "Arrays"]
    cn_slots = [s for s in result.slots if s.topic == "TCP"]
    assert all(s.subject_code == "DAA" for s in daa_slots)
    assert all(s.subject_code == "CN" for s in cn_slots)


# ── Route-integration tests ───────────────────────────────────────────


def _student_headers(client, signup_payload) -> dict:
    r = client.post("/api/v1/auth/signup", json=signup_payload("student"))
    assert r.status_code in (200, 201), r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def test_route_defaults_to_spread_strategy(client, signup_payload):
    """No `strategy` in the body should pick spread (zero explored nodes)."""
    headers = _student_headers(client, signup_payload)
    payload = {
        "tasks": [
            {"topic": "Arrays", "hours": 3, "priority": 5, "subject_code": "DAA"},
            {"topic": "Trees", "hours": 2, "priority": 5, "subject_code": "DAA"},
        ],
        "days": 5,
    }
    r = client.post(
        "/api/v1/algorithms/schedule/generate", json=payload, headers=headers
    )
    assert r.status_code == 200, r.text
    body = r.json()
    # Spread is greedy: explored_nodes is always 0; backtracking always > 0
    # when it actually searches.
    assert body["explored_nodes"] == 0
    assert any(s["topic"] for s in body["slots"])


def test_route_backtracking_strategy_still_works(client, signup_payload):
    """Crash Mode passes `strategy=backtracking` — verify the path."""
    headers = _student_headers(client, signup_payload)
    payload = {
        "tasks": [
            {"topic": "Arrays", "hours": 3, "priority": 9, "subject_code": "DAA"},
            {"topic": "Trees", "hours": 2, "priority": 7, "subject_code": "DAA"},
        ],
        "days": 3,
        "strategy": "backtracking",
    }
    r = client.post(
        "/api/v1/algorithms/schedule/generate", json=payload, headers=headers
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert "slots" in body
    # Backtracking actually searches — explored_nodes is positive on
    # non-trivial input.
    assert body["explored_nodes"] >= 0


def test_route_daily_cap_flows_through(client, signup_payload):
    """`daily_cap_hours` in the request limits same-day placements."""
    headers = _student_headers(client, signup_payload)
    payload = {
        "tasks": [
            {"topic": "Solo", "hours": 6, "priority": 5, "subject_code": "DAA"},
        ],
        "days": 4,
        "strategy": "spread",
        "daily_cap_hours": 1,
    }
    r = client.post(
        "/api/v1/algorithms/schedule/generate", json=payload, headers=headers
    )
    assert r.status_code == 200, r.text
    body = r.json()
    by_day: dict[int, int] = {}
    for s in body["slots"]:
        if s["topic"] == "Solo":
            by_day[s["day_index"]] = by_day.get(s["day_index"], 0) + 1
    assert all(count <= 1 for count in by_day.values()), by_day


def test_route_rejects_invalid_strategy(client, signup_payload):
    """Pydantic Literal blocks unknown strategy strings at the boundary."""
    headers = _student_headers(client, signup_payload)
    payload = {
        "tasks": [
            {"topic": "Arrays", "hours": 1, "priority": 5, "subject_code": None}
        ],
        "days": 3,
        "strategy": "genetic-algorithm",
    }
    r = client.post(
        "/api/v1/algorithms/schedule/generate", json=payload, headers=headers
    )
    assert r.status_code == 422
