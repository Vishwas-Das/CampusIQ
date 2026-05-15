"""Algorithm-showcase endpoints (Phase 19, F21/F23/F25/F26).

Bundles all four DAA/DMS algorithm features into a single `/algorithms/`
prefix so the syllabus mapping is easy to point at:

- POST /algorithms/hamming/quiz/{quiz_id}     — DMS IV — pairwise Hamming
- POST /algorithms/inclusion-exclusion        — DMS I  — set operations
- POST /algorithms/graph-coloring/quizzes     — DMS V  — graph coloring
- POST /algorithms/schedule/generate          — DAA V  — backtracking + B&B
"""
from __future__ import annotations

import uuid
from dataclasses import asdict

from fastapi import APIRouter, Depends

from app.api.deps import CurrentUser, DbSession, require_role
from app.schemas.algorithms import (
    GenerateScheduleRequest,
    GenerateScheduleResponse,
    GraphColoringResponse,
    HammingPairResponse,
    InclusionExclusionRequest,
    InclusionExclusionResponse,
    QuizSlotAssignmentResponse,
    ScheduleSlotResponse,
    SimilarityCheckResponse,
    SkillIntersection,
    SkillSetCount,
    StudyTaskResponse,
)
from app.services import (
    backtracking_schedule,
    graph_coloring,
    hamming,
    inclusion_exclusion,
    spread_schedule,
)

router = APIRouter()


# ════════════════════════════════════════════════════════════════
# Hamming similarity checker (F23)
# ════════════════════════════════════════════════════════════════

@router.post(
    "/hamming/quiz/{quiz_id}",
    response_model=SimilarityCheckResponse,
    dependencies=[Depends(require_role("teacher", "admin"))],
    summary="Run pairwise Hamming similarity over a quiz's attempts",
)
def run_similarity_check(
    quiz_id: uuid.UUID,
    db: DbSession,
    current_user: CurrentUser,
    max_distance: int = 2,
    persist: bool = True,
) -> SimilarityCheckResponse:
    flagged, total_attempts, mean_sim = hamming.analyze_quiz(
        db, current_user, quiz_id=quiz_id, max_distance=max_distance
    )
    persisted_count = hamming.persist_flags(db, flagged) if persist else 0
    return SimilarityCheckResponse(
        quiz_id=quiz_id,
        total_attempts=total_attempts,
        flagged_pairs=[HammingPairResponse(**asdict(f)) for f in flagged],
        flagged_count=len(flagged),
        mean_pairwise_similarity=mean_sim,
        persisted_count=persisted_count,
    )


# ════════════════════════════════════════════════════════════════
# Inclusion-exclusion skill analytics (F25)
# ════════════════════════════════════════════════════════════════

@router.post(
    "/inclusion-exclusion",
    response_model=InclusionExclusionResponse,
    dependencies=[Depends(require_role("teacher", "admin"))],
    summary="Inclusion-exclusion counting over student skill sets",
)
def run_inclusion_exclusion(
    data: InclusionExclusionRequest,
    db: DbSession,
    current_user: CurrentUser,
) -> InclusionExclusionResponse:
    result = inclusion_exclusion.analyze_skills(db, skills=data.skills)
    return InclusionExclusionResponse(
        skills=result.skills,
        per_skill=[SkillSetCount(**p) for p in result.per_skill],
        intersections=[SkillIntersection(**i) for i in result.intersections],
        union_count_naive=result.union_count_naive,
        union_count_actual=result.union_count_actual,
        overlap_correction=result.overlap_correction,
        total_students=result.total_students,
        matching_student_names=result.matching_student_names,
    )


# ════════════════════════════════════════════════════════════════
# Graph coloring quiz scheduler (F21)
# ════════════════════════════════════════════════════════════════

@router.post(
    "/graph-coloring/quizzes",
    response_model=GraphColoringResponse,
    dependencies=[Depends(require_role("teacher", "admin"))],
    summary="Greedy graph coloring to assign conflict-free quiz time slots",
)
def run_graph_coloring(
    db: DbSession, current_user: CurrentUser
) -> GraphColoringResponse:
    result = graph_coloring.color_quizzes(db, current_user)
    return GraphColoringResponse(
        assignments=[QuizSlotAssignmentResponse(**asdict(a)) for a in result.assignments],
        chromatic_number=result.chromatic_number,
        quiz_count=result.quiz_count,
        edge_count=result.edge_count,
        color_groups={str(k): v for k, v in result.color_groups.items()},
    )


# ════════════════════════════════════════════════════════════════
# Backtracking study schedule (F26)
# ════════════════════════════════════════════════════════════════

@router.post(
    "/schedule/generate",
    response_model=GenerateScheduleResponse,
    summary="Study schedule for the next N days (spread by default, B&B for crash mode)",
)
def generate_schedule(
    data: GenerateScheduleRequest,
    db: DbSession,
    current_user: CurrentUser,
) -> GenerateScheduleResponse:
    tasks = [
        backtracking_schedule.StudyTask(
            topic=t.topic,
            hours=t.hours,
            priority=t.priority,
            subject_code=t.subject_code,
        )
        for t in data.tasks
    ]
    if data.strategy == "backtracking":
        result = backtracking_schedule.generate_schedule(tasks, days=data.days)
    else:
        result = spread_schedule.generate_spread_schedule(
            tasks,
            days=data.days,
            daily_cap_hours=data.daily_cap_hours,
        )
    return GenerateScheduleResponse(
        slots=[ScheduleSlotResponse(**asdict(s)) for s in result.slots],
        scheduled_tasks=[StudyTaskResponse(**asdict(t)) for t in result.scheduled_tasks],
        skipped_tasks=[StudyTaskResponse(**asdict(t)) for t in result.skipped_tasks],
        total_value=result.total_value,
        total_hours_scheduled=result.total_hours_scheduled,
        explored_nodes=result.explored_nodes,
    )
