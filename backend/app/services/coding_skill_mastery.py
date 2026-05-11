"""Tiny bridge between coding submissions and the skill graph.

V1 simply declares each skill linked to a solved problem in
`StudentProfile.skills`. `skill_graph.compute_mastery` treats declared skills as
0.75 baseline, so solving a problem in a topic the student hasn't declared
moves their mastery for that topic to 0.75 (or stays at whatever quiz history
already puts them at — compute_mastery takes the max signal).

V3 (skill-tree UI) will likely replace this with a graduated per-skill mastery
column on `StudentProfile` so the bump scales with difficulty (easy=+0.05,
medium=+0.12, hard=+0.25). For V1 we deliberately keep it minimal — adding a
graduated column requires a schema change + an update to compute_mastery, which
isn't worth the complexity until the skill-tree page actually visualises it.
"""
from __future__ import annotations

import logging

from sqlalchemy.orm import Session

from app.models.coding import CodingProblem
from app.models.user import User

logger = logging.getLogger(__name__)


def bump_mastery_for_solve(db: Session, user: User, problem: CodingProblem) -> list[str]:
    """Declare every skill_node_name from `problem` in the user's profile.

    Returns the list of names that were newly added (empty if all already
    declared). Caller is responsible for committing the surrounding txn.
    """
    profile = user.student_profile
    if profile is None:
        return []

    current: list[str] = [str(s) for s in (profile.skills or [])]
    seen_lower = {s.strip().lower() for s in current}
    added: list[str] = []
    for skill_name in problem.skill_node_names or []:
        name = str(skill_name).strip()
        if not name:
            continue
        if name.lower() in seen_lower:
            continue
        current.append(name)
        seen_lower.add(name.lower())
        added.append(name)

    if added:
        profile.skills = current
        db.flush()
        logger.info("Declared %d new skills for user %s via coding solve: %s",
                    len(added), user.id, added)
    return added
