"""Realistic study schedule generator.

The branch-and-bound packer in `backtracking_schedule.py` optimises for
"total priority value scheduled" which, with short inputs (e.g. 1 hour
each across five subjects), happily piles everything onto Monday because
that's still the optimum. That makes for a fun DAA-Unit-V demo but a
useless weekly planner.

This module is what the student-facing Study Schedule page actually
calls. It does three things differently:

1. **Spreads tasks across days.** Each task's hours are distributed
   round-robin — a 4-hour task becomes 4× 1-hour blocks on 4 different
   days when there's capacity.

2. **Caps daily load.** No day exceeds `daily_cap_hours` (default 3)
   so the plan is something a human could actually follow.

3. **Realistic placement.** Day starts at 9 AM, lunch lock at 1 PM,
   resume at 2 PM if needed, dinner lock at 8 PM. Same-task blocks on
   the same day stay contiguous so the UI shows one solid block instead
   of two stacked ones.

The output shape (`ScheduleResult`) matches the backtracking module so
callers can swap strategies without touching their response handling.
`explored_nodes` is reported as 0 because nothing was searched — the
algorithm is a deterministic greedy.
"""
from __future__ import annotations

import logging

from app.services.backtracking_schedule import (
    DEFAULT_DAY_HOURS,
    DEFAULT_LOCKED_LABEL_BY_HOUR,
    ScheduleResult,
    ScheduleSlot,
    StudyTask,
    build_empty_grid,
)

logger = logging.getLogger(__name__)


# Per-day default cap. The hard ceiling is the most we'll ever do per day
# even if the caller asks for more — five hours of focused study is a lot.
DEFAULT_DAILY_CAP_HOURS = 3
HARD_DAILY_CEILING = 5

# Day starts at 9 AM (not 8) so the student has a slow morning. The grid
# itself still goes 8 AM → 9 PM, we just don't place blocks at 8 AM.
PREFERRED_START_HOUR = 9


def generate_spread_schedule(
    tasks: list[StudyTask],
    *,
    days: int = 7,
    daily_cap_hours: int | None = None,
    hours: list[int] | None = None,
    locked_hours: dict[int, str] | None = None,
) -> ScheduleResult:
    """Round-robin spread planner. See module docstring."""
    if hours is None:
        hours = DEFAULT_DAY_HOURS
    if locked_hours is None:
        locked_hours = DEFAULT_LOCKED_LABEL_BY_HOUR

    cap_request = (
        daily_cap_hours if daily_cap_hours is not None else DEFAULT_DAILY_CAP_HOURS
    )
    daily_cap = max(1, min(HARD_DAILY_CEILING, cap_request))

    if not tasks:
        return ScheduleResult(
            slots=build_empty_grid(days=days, hours=hours, locked_hours=locked_hours),
            scheduled_tasks=[],
            skipped_tasks=[],
            total_value=0.0,
            total_hours_scheduled=0,
            explored_nodes=0,
        )

    # Heavier / higher-priority tasks claim days first. Ties: longer first.
    indexed: list[tuple[int, StudyTask]] = list(enumerate(tasks))
    indexed.sort(key=lambda pair: (-pair[1].priority, -pair[1].hours))

    # `day_to_task_units[d]` is a list of original-task indices, one entry
    # per hour-unit landing on that day. Length == hours assigned to day d.
    day_to_task_units: list[list[int]] = [[] for _ in range(days)]
    placed_hours_by_task: dict[int, int] = {idx: 0 for idx in range(len(tasks))}

    for task_idx, task in indexed:
        for _ in range(task.hours):
            # First pass: days where this task isn't already today AND have
            # spare capacity. Encourages spread across the week.
            candidates = [
                d
                for d in range(days)
                if len(day_to_task_units[d]) < daily_cap
                and task_idx not in day_to_task_units[d]
            ]
            if not candidates:
                # Fallback: same task may land twice on a day if every other
                # option is full. Better than skipping.
                candidates = [
                    d for d in range(days) if len(day_to_task_units[d]) < daily_cap
                ]
            if not candidates:
                break  # plan is full; remaining hours of this task get skipped
            best_day = min(
                candidates, key=lambda d: (len(day_to_task_units[d]), d)
            )
            day_to_task_units[best_day].append(task_idx)
            placed_hours_by_task[task_idx] += 1

    # Paint slots into the grid.
    grid = build_empty_grid(days=days, hours=hours, locked_hours=locked_hours)
    grid_by_pos: dict[tuple[int, int], ScheduleSlot] = {
        (s.day_index, s.hour_index): s for s in grid
    }
    available_hours_template = [
        h for h in hours if h not in locked_hours and h >= PREFERRED_START_HOUR
    ]

    for day in range(days):
        units = day_to_task_units[day]
        # Sort by task index so same-task units stay contiguous within the
        # day (the UI groups consecutive same-topic slots into one block).
        # Stable sort keeps insertion order across different tasks.
        units.sort()
        for slot_idx, task_idx in enumerate(units):
            if slot_idx >= len(available_hours_template):
                break  # ran out of placeable hours on this day
            h = available_hours_template[slot_idx]
            slot = grid_by_pos.get((day, h))
            if slot is None:
                continue
            slot.topic = tasks[task_idx].topic
            slot.subject_code = tasks[task_idx].subject_code

    # Build result lists. A task counts as "scheduled" if at least one of
    # its hours made the cut; "skipped" if zero.
    scheduled: list[StudyTask] = []
    skipped: list[StudyTask] = []
    total_hours = 0
    for task_idx, task in enumerate(tasks):
        placed = placed_hours_by_task.get(task_idx, 0)
        if placed == 0:
            skipped.append(task)
        else:
            scheduled.append(task)
            total_hours += placed

    total_value = sum(t.priority for t in scheduled)

    return ScheduleResult(
        slots=grid,
        scheduled_tasks=scheduled,
        skipped_tasks=skipped,
        total_value=total_value,
        total_hours_scheduled=total_hours,
        explored_nodes=0,
    )
