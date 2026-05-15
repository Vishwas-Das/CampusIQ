"""Seed the canonical demo state for the 3-laptop CampusIQ demo.

Usage (always from `backend/` so the .env loader picks up the right DB):

    .venv/bin/python scripts/seed_demo.py            # idempotent upsert
    .venv/bin/python scripts/seed_demo.py --reset    # wipe demo accounts first
    .venv/bin/python scripts/seed_demo.py --reset --no-rag

Creates four accounts that the demo runner can hand straight to the
projector + two teacher laptops:

    teacher.a@example.com  / DemoPass123   (DAA — CD343AI, 3 quizzes)
    teacher.b@example.com  / DemoPass123   (DMS — CS241AT, 2 quizzes)
    student.demo@example.com / DemoPass123 (enrolled, attempts, resume)
    admin.demo@example.com / DemoPass123   (admin)

The script is idempotent — re-running upserts by primary unique key
(email for users, code for subjects, title-per-subject for quizzes,
title for boss battles via the existing service). Use `--reset` to
drop the demo users (cascades to their quizzes, attempts, resume,
profile, announcements, etc.) before re-seeding.

`--no-rag` is a placeholder for skipping document embedding — the
current seed doesn't ingest any documents to keep it fast, so the flag
is reserved for the future when we wire teacher document uploads in.
"""
from __future__ import annotations

import argparse
import logging
import sys
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from pathlib import Path

# Allow `python scripts/seed_demo.py` from the backend root.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from sqlalchemy import select  # noqa: E402

from app.core.database import SessionLocal  # noqa: E402
from app.core.security import hash_password  # noqa: E402
from app.models.algorithm import StudyOptimizerResult  # noqa: E402
from app.models.content import (  # noqa: E402
    Announcement,
    AnnouncementTarget,
)
from app.models.placement import Resume  # noqa: E402
from app.models.quiz import (  # noqa: E402
    Difficulty,
    Question,
    QuestionType,
    Quiz,
    QuizAttempt,
)
from app.models.user import (  # noqa: E402
    StudentProfile,
    Subject,
    TeacherProfile,
    User,
    UserRole,
)
from app.services import boss_battles as boss_battles_service  # noqa: E402

logging.basicConfig(level=logging.INFO, format="%(message)s")
logger = logging.getLogger("seed_demo")


# ── Personas ──────────────────────────────────────────────────────────

DEMO_PASSWORD = "DemoPass123"

EMAILS = {
    "teacher_a": "teacher.a@example.com",
    "teacher_b": "teacher.b@example.com",
    "student": "student.demo@example.com",
    "admin": "admin.demo@example.com",
}

# Subject + quiz catalog. Quizzes are intentionally small (5 MCQs each)
# so taking one during the demo takes ~30 seconds.

SUBJECTS = [
    {
        "code": "CD343AI",
        "name": "Design and Analysis of Algorithms",
        "branch": "CSE",
        "semester": 4,
        "owner": "teacher_a",
        "announcement": {
            "title": "Phase test on Greedy + DP — next Monday",
            "body": (
                "Welcome to DAA. The first phase test covers Greedy (Huffman, "
                "MST, scheduling) and DP (knapsack, LIS). The unit tests on "
                "CampusIQ are the warm-up — clear all three before next Monday."
            ),
        },
        "quizzes": [
            {
                "title": "Huffman Coding Fundamentals",
                "difficulty": Difficulty.MEDIUM,
                "questions": [
                    (
                        "Huffman coding is a:",
                        ["Dynamic programming algorithm", "Greedy algorithm",
                         "Divide-and-conquer algorithm", "Backtracking algorithm"],
                        "Greedy algorithm",
                        "Huffman Coding",
                    ),
                    (
                        "What data structure is used to build the Huffman tree?",
                        ["Stack", "Queue", "Min-heap", "Hash table"],
                        "Min-heap",
                        "Huffman Coding",
                    ),
                    (
                        "Time complexity of building a Huffman tree for n symbols?",
                        ["O(n)", "O(n log n)", "O(n²)", "O(2^n)"],
                        "O(n log n)",
                        "Huffman Coding",
                    ),
                    (
                        "Huffman codes are:",
                        ["Fixed-length", "Prefix-free variable-length",
                         "Always shorter than ASCII", "Always palindromic"],
                        "Prefix-free variable-length",
                        "Huffman Coding",
                    ),
                    (
                        "Best-case compression by Huffman happens when symbol "
                        "frequencies are:",
                        ["Uniform", "Skewed", "All equal", "Random"],
                        "Skewed",
                        "Huffman Coding",
                    ),
                ],
            },
            {
                "title": "Dijkstra & Shortest Paths",
                "difficulty": Difficulty.MEDIUM,
                "questions": [
                    (
                        "Dijkstra's algorithm fails on graphs with:",
                        ["Cycles", "Negative-weight edges",
                         "More than 1000 nodes", "Disconnected components"],
                        "Negative-weight edges",
                        "Dijkstra",
                    ),
                    (
                        "With a binary heap, Dijkstra runs in:",
                        ["O(V + E)", "O((V + E) log V)", "O(V²)", "O(VE)"],
                        "O((V + E) log V)",
                        "Dijkstra",
                    ),
                    (
                        "Dijkstra is a:",
                        ["Greedy algorithm", "Divide-and-conquer", "DP algorithm",
                         "Randomized algorithm"],
                        "Greedy algorithm",
                        "Dijkstra",
                    ),
                    (
                        "Which algorithm handles negative edges (no negative cycles)?",
                        ["Dijkstra", "Bellman-Ford", "DFS", "Prim's"],
                        "Bellman-Ford",
                        "Shortest Paths",
                    ),
                    (
                        "Single-source shortest paths on a DAG is most efficient with:",
                        ["Dijkstra", "Bellman-Ford",
                         "Topological sort + relaxation", "Floyd-Warshall"],
                        "Topological sort + relaxation",
                        "Shortest Paths",
                    ),
                ],
            },
            {
                "title": "0/1 Knapsack DP",
                "difficulty": Difficulty.HARD,
                "questions": [
                    (
                        "0/1 knapsack runs in:",
                        ["O(n)", "O(nW)", "O(n log W)", "O(2^n)"],
                        "O(nW)",
                        "Knapsack",
                    ),
                    (
                        "What property makes a problem solvable by DP?",
                        ["Greedy choice", "Optimal substructure + overlapping subproblems",
                         "Linearity", "Random access"],
                        "Optimal substructure + overlapping subproblems",
                        "Dynamic Programming",
                    ),
                    (
                        "Fractional knapsack is best solved by:",
                        ["DP", "Greedy (value/weight ratio)",
                         "Branch and bound", "Backtracking"],
                        "Greedy (value/weight ratio)",
                        "Knapsack",
                    ),
                    (
                        "Space complexity of standard 0/1 knapsack DP table?",
                        ["O(n)", "O(nW)", "O(W)", "O(n²)"],
                        "O(nW)",
                        "Knapsack",
                    ),
                    (
                        "Can 0/1 knapsack be solved with greedy?",
                        ["Yes, always", "No, only fractional knapsack",
                         "Yes, with a heap", "Only on sorted input"],
                        "No, only fractional knapsack",
                        "Knapsack",
                    ),
                ],
            },
        ],
    },
    {
        "code": "CS241AT",
        "name": "Discrete Mathematical Structures",
        "branch": "CSE",
        "semester": 4,
        "owner": "teacher_b",
        "announcement": {
            "title": "Set theory practice quiz is now live",
            "body": (
                "We covered inclusion-exclusion in lecture. Practice quiz is "
                "open — try it before tutorial on Friday. The CampusIQ "
                "Skill Analytics page also has a live demo of the formula "
                "over student skill sets."
            ),
        },
        "quizzes": [
            {
                "title": "Set Theory & Inclusion-Exclusion",
                "difficulty": Difficulty.MEDIUM,
                "questions": [
                    (
                        "|A ∪ B| =",
                        ["|A| + |B|", "|A| × |B|", "|A| + |B| − |A ∩ B|",
                         "|A| − |B|"],
                        "|A| + |B| − |A ∩ B|",
                        "Set Theory",
                    ),
                    (
                        "For three sets, |A ∪ B ∪ C| =",
                        ["|A| + |B| + |C|",
                         "|A| + |B| + |C| − |A ∩ B| − |A ∩ C| − |B ∩ C| + |A ∩ B ∩ C|",
                         "|A ∩ B ∩ C|",
                         "|A| × |B| × |C|"],
                        "|A| + |B| + |C| − |A ∩ B| − |A ∩ C| − |B ∩ C| + |A ∩ B ∩ C|",
                        "Inclusion-Exclusion",
                    ),
                    (
                        "Power set of {a, b, c} has how many elements?",
                        ["3", "6", "8", "9"],
                        "8",
                        "Set Theory",
                    ),
                    (
                        "Cartesian product |A × B| where |A| = 3, |B| = 4?",
                        ["7", "12", "16", "24"],
                        "12",
                        "Set Theory",
                    ),
                    (
                        "An equivalence relation must be:",
                        ["Reflexive, symmetric, transitive",
                         "Total and antisymmetric",
                         "Reflexive only",
                         "Transitive only"],
                        "Reflexive, symmetric, transitive",
                        "Relations",
                    ),
                ],
            },
            {
                "title": "Graphs & Coloring",
                "difficulty": Difficulty.MEDIUM,
                "questions": [
                    (
                        "Chromatic number of the complete graph K₄?",
                        ["2", "3", "4", "5"],
                        "4",
                        "Graph Coloring",
                    ),
                    (
                        "A bipartite graph has chromatic number at most:",
                        ["1", "2", "3", "It depends"],
                        "2",
                        "Graph Coloring",
                    ),
                    (
                        "Number of edges in a tree with n vertices?",
                        ["n", "n − 1", "n + 1", "2n"],
                        "n − 1",
                        "Trees",
                    ),
                    (
                        "Hamming distance between 10110 and 11000?",
                        ["1", "2", "3", "4"],
                        "3",
                        "Hamming Distance",
                    ),
                    (
                        "An Eulerian circuit exists in a connected graph iff:",
                        ["Every vertex has even degree",
                         "Every vertex has odd degree",
                         "There are no cycles",
                         "There is exactly one cycle"],
                        "Every vertex has even degree",
                        "Graph Theory",
                    ),
                ],
            },
        ],
    },
]


# Realistic "attempt fingerprint" per quiz so weak areas show up in the
# student dashboard. Each entry is the index of the option the student
# picked for each question — None means skipped.
STUDENT_ATTEMPTS: dict[str, list[int | None]] = {
    "Huffman Coding Fundamentals": [1, 2, 1, 1, 0],   # 4/5 (got Q5 wrong: picked Uniform)
    "Dijkstra & Shortest Paths": [1, 1, 0, 1, 2],     # 5/5 — strong on Dijkstra
    "0/1 Knapsack DP": [0, 0, 0, 0, 0],               # 0/5 — weakest topic
    "Set Theory & Inclusion-Exclusion": [2, 1, 2, 1, 0],   # 5/5
    # Last DMS quiz intentionally unattempted so the dashboard's
    # "unattempted" task feed signal lights up.
}


# Resume content blob — matches the Resume.content JSON shape used by
# the frontend. Realistic enough to drive ATS + GitHub import demos.
RESUME_CONTENT: dict = {
    "personal": {
        "name": "Demo Student",
        "email": EMAILS["student"],
        "phone": "+91 98765 43210",
        "location": "Bengaluru, India",
        "github": "https://github.com/arun-sanjay",
        "linkedin": "https://linkedin.com/in/demo-student",
        "tagline": "4th-sem CSE @ RVCE · SWE intern hunt 2026",
    },
    "education": [
        {
            "institution": "RV College of Engineering",
            "degree": "B.E. Computer Science",
            "start_year": 2024,
            "end_year": 2028,
            "cgpa": "9.1 / 10",
            "highlights": [
                "Top 10% in 4th semester",
                "Active in the Coding Club and Open Source Forum",
            ],
        },
    ],
    "experience": [],
    "projects": [
        {
            "name": "CampusIQ",
            "summary": (
                "AI-assisted academic + placement platform for engineering "
                "students. Built the Adaptive Learning Engine (Dijkstra + "
                "Knapsack over a dynamic skill graph) and the voice mock "
                "interview pipeline."
            ),
            "stack": ["FastAPI", "React 19", "PostgreSQL + pgvector",
                      "Anthropic Claude", "ElevenLabs"],
            "highlights": [
                "Implemented per-user TCP-style WebSocket retry layer "
                "with sequence numbers + exponential backoff",
                "Designed dynamic edge rescaling formula validated on real "
                "classmate mastery data",
            ],
        },
        {
            "name": "Quiz Engine with Weak-Area Detection",
            "summary": (
                "Greedy adaptive-difficulty quiz system with boolean weak-area "
                "thresholding across the last 3 attempts on each subject."
            ),
            "stack": ["Python", "SQLAlchemy", "pytest"],
            "highlights": [
                "Used Hamming distance over answer bit-vectors to flag "
                "suspicious quiz submissions",
            ],
        },
    ],
    "skills": [
        "Python", "TypeScript", "FastAPI", "React", "SQL", "PostgreSQL",
        "Data Structures", "Algorithms", "Graph Theory",
        "Discrete Math", "Git",
    ],
    "achievements": [
        "Boss Battle leaderboard top 3 in DAA",
        "Confidence Coach streak: 5 sessions in a row above 80",
    ],
}


# ── Helpers ───────────────────────────────────────────────────────────


def get_or_create_user(
    db, *, email: str, full_name: str, role: UserRole, hashed: str
) -> User:
    """Idempotent upsert keyed on email."""
    user = db.scalar(select(User).where(User.email == email))
    if user is None:
        user = User(
            email=email,
            full_name=full_name,
            role=role,
            hashed_password=hashed,
            is_active=True,
        )
        db.add(user)
        db.flush()
        logger.info("created user %s (%s)", email, role.value)
    return user


def ensure_student_profile(db, user: User) -> StudentProfile:
    if user.student_profile is not None:
        return user.student_profile
    profile = StudentProfile(
        user_id=user.id,
        branch="CSE",
        semester=4,
        cgpa=Decimal("9.10"),
        github_url="https://github.com/arun-sanjay",
        linkedin_url="https://linkedin.com/in/demo-student",
        skills=[
            "Python", "TypeScript", "FastAPI", "React",
            "Data Structures", "Algorithms",
        ],
        target_companies=["Google", "Meta", "Amazon"],
        target_role="SWE",
        xp_total=420,
        current_level=3,
        streak_days=5,
    )
    db.add(profile)
    db.flush()
    return profile


def ensure_teacher_profile(
    db, user: User, *, department: str = "CSE", designation: str = "Assistant Professor"
) -> TeacherProfile:
    if user.teacher_profile is not None:
        return user.teacher_profile
    profile = TeacherProfile(
        user_id=user.id,
        department_name=department,
        designation=designation,
    )
    db.add(profile)
    db.flush()
    return profile


def get_or_create_subject(
    db, *, code: str, name: str, teacher: User, branch: str, semester: int
) -> Subject:
    subject = db.scalar(select(Subject).where(Subject.code == code))
    if subject is None:
        subject = Subject(
            teacher_id=teacher.id,
            code=code,
            name=name,
            description=f"{name} — RVCE 4th sem demo subject.",
            branch=branch,
            semester=semester,
        )
        db.add(subject)
        db.flush()
        logger.info("created subject %s — %s", code, name)
    return subject


def get_or_create_quiz(
    db,
    *,
    subject: Subject,
    teacher: User,
    title: str,
    difficulty: Difficulty,
    question_specs: list[tuple],
) -> Quiz:
    """`question_specs` items: (text, options, correct_option, topic)."""
    quiz = db.scalar(
        select(Quiz).where(Quiz.subject_id == subject.id, Quiz.title == title)
    )
    if quiz is not None:
        return quiz
    quiz = Quiz(
        subject_id=subject.id,
        created_by_id=teacher.id,
        title=title,
        description=f"5-question MCQ quiz for {subject.code} — {title}.",
        difficulty=difficulty,
        time_limit_minutes=8,
        is_published=True,
        is_ai_generated=False,
    )
    db.add(quiz)
    db.flush()
    for idx, (text, options, correct, topic) in enumerate(question_specs):
        q = Question(
            quiz_id=quiz.id,
            order_index=idx,
            question_text=text,
            question_type=QuestionType.MCQ,
            options=list(options),
            correct_answer=correct,
            difficulty=difficulty,
            topic=topic,
        )
        db.add(q)
    db.flush()
    logger.info("created quiz %s (%d questions)", title, len(question_specs))
    return quiz


def get_or_create_announcement(
    db, *, author: User, subject: Subject, title: str, body: str
) -> Announcement:
    row = db.scalar(
        select(Announcement).where(
            Announcement.author_id == author.id,
            Announcement.subject_id == subject.id,
            Announcement.title == title,
        )
    )
    if row is None:
        row = Announcement(
            author_id=author.id,
            subject_id=subject.id,
            title=title,
            body=body,
            target=AnnouncementTarget.SUBJECT,
        )
        db.add(row)
        db.flush()
        logger.info("created announcement: %s", title)
    return row


def seed_attempt(db, *, student: User, quiz: Quiz, picked: list[int | None]) -> None:
    """Insert a QuizAttempt for `student` on `quiz` based on `picked` indices.

    Idempotent: if any attempt already exists, do nothing.
    """
    existing = db.scalar(
        select(QuizAttempt).where(
            QuizAttempt.quiz_id == quiz.id, QuizAttempt.student_id == student.id
        )
    )
    if existing is not None:
        return
    questions = sorted(quiz.questions, key=lambda q: q.order_index)
    if len(picked) != len(questions):
        logger.warning(
            "skipping attempt for %s — pick count %s doesn't match question count %s",
            quiz.title,
            len(picked),
            len(questions),
        )
        return
    correct = 0
    answer_log: list[dict] = []
    bit_vector_parts: list[str] = []
    for q, pick_idx in zip(questions, picked):
        if pick_idx is None or q.options is None or pick_idx >= len(q.options):
            student_answer = ""
            is_correct = False
        else:
            student_answer = str(q.options[pick_idx])
            is_correct = student_answer == q.correct_answer
        if is_correct:
            correct += 1
        bit_vector_parts.append("1" if is_correct else "0")
        answer_log.append({
            "question_id": str(q.id),
            "student_answer": student_answer,
            "is_correct": is_correct,
            "topic": q.topic,
        })
    score = (correct / len(questions)) * 100 if questions else 0
    attempt = QuizAttempt(
        quiz_id=quiz.id,
        student_id=student.id,
        score=Decimal(f"{score:.2f}"),
        total_questions=len(questions),
        correct_count=correct,
        time_taken_seconds=180,
        answers=answer_log,
        answer_bit_vector="".join(bit_vector_parts),
        completed_at=datetime.now(tz=timezone.utc) - timedelta(days=1),
    )
    db.add(attempt)
    db.flush()
    logger.info("seeded attempt %s — %d/%d", quiz.title, correct, len(questions))


def ensure_resume(db, *, student: User) -> Resume:
    resume = db.scalar(select(Resume).where(Resume.student_id == student.id))
    if resume is None:
        resume = Resume(
            student_id=student.id,
            content=RESUME_CONTENT,
            template="technical",
            ats_score=Decimal("78.50"),
        )
        db.add(resume)
        db.flush()
        logger.info("seeded resume for %s", student.email)
    return resume


def ensure_optimizer_seed_row(db, *, student: User) -> None:
    """Plant one StudyOptimizerResult row so the SkillGap page has prior
    history to show on first paint — the actual plan will be re-computed
    live from the dashboard's "Recompute" button.
    """
    existing = db.scalar(
        select(StudyOptimizerResult).where(StudyOptimizerResult.student_id == student.id)
    )
    if existing is not None:
        return
    row = StudyOptimizerResult(
        student_id=student.id,
        target_company="Google",
        target_role="SWE",
        available_hours=Decimal("15.00"),
        included_topics=["Dynamic Programming", "Graph Algorithms", "System Design"],
        excluded_topics=["Operating Systems Deep Dive"],
        predicted_improvement=Decimal("18.50"),
    )
    db.add(row)
    db.flush()
    logger.info("seeded study_optimizer_results row for demo student")


# ── Main flow ─────────────────────────────────────────────────────────


def reset_demo_users(db) -> int:
    """Delete demo users; CASCADE handles their downstream rows."""
    count = 0
    for email in EMAILS.values():
        user = db.scalar(select(User).where(User.email == email))
        if user is not None:
            db.delete(user)
            count += 1
    if count:
        db.commit()
        logger.info("reset: deleted %d demo users (cascade dropped their rows)", count)
    return count


def seed(*, reset: bool, with_rag: bool) -> None:
    hashed = hash_password(DEMO_PASSWORD)
    with SessionLocal() as db:
        if reset:
            reset_demo_users(db)

        teacher_a = get_or_create_user(
            db,
            email=EMAILS["teacher_a"],
            full_name="Alice Reddy",
            role=UserRole.TEACHER,
            hashed=hashed,
        )
        teacher_b = get_or_create_user(
            db,
            email=EMAILS["teacher_b"],
            full_name="Bharat Iyer",
            role=UserRole.TEACHER,
            hashed=hashed,
        )
        student = get_or_create_user(
            db,
            email=EMAILS["student"],
            full_name="Demo Student",
            role=UserRole.STUDENT,
            hashed=hashed,
        )
        admin = get_or_create_user(
            db,
            email=EMAILS["admin"],
            full_name="Demo Admin",
            role=UserRole.ADMIN,
            hashed=hashed,
        )
        _ = admin  # admin has no required state beyond existing

        ensure_teacher_profile(db, teacher_a, department="DAA Faculty")
        ensure_teacher_profile(db, teacher_b, department="DMS Faculty")
        ensure_student_profile(db, student)

        # Subjects + their quizzes + announcements.
        teacher_map = {"teacher_a": teacher_a, "teacher_b": teacher_b}
        for spec in SUBJECTS:
            owner = teacher_map[spec["owner"]]
            subject = get_or_create_subject(
                db,
                code=spec["code"],
                name=spec["name"],
                teacher=owner,
                branch=spec["branch"],
                semester=spec["semester"],
            )
            for q_spec in spec["quizzes"]:
                quiz = get_or_create_quiz(
                    db,
                    subject=subject,
                    teacher=owner,
                    title=q_spec["title"],
                    difficulty=q_spec["difficulty"],
                    question_specs=q_spec["questions"],
                )
                picks = STUDENT_ATTEMPTS.get(q_spec["title"])
                if picks is not None:
                    seed_attempt(db, student=student, quiz=quiz, picked=picks)
            ann = spec["announcement"]
            get_or_create_announcement(
                db,
                author=owner,
                subject=subject,
                title=ann["title"],
                body=ann["body"],
            )

        ensure_resume(db, student=student)
        ensure_optimizer_seed_row(db, student=student)

        # Boss battles use the per-title idempotent seed from the service.
        created = boss_battles_service.seed_sample_battles(db)
        if created:
            logger.info("seeded %d boss battles", created)

        db.commit()
        logger.info("\nDemo seed complete. Login credentials (password = %s):", DEMO_PASSWORD)
        for label, email in EMAILS.items():
            logger.info("  %-10s %s", label, email)
        if not with_rag:
            logger.info("(--no-rag was passed; document embeddings were skipped)")


# ── CLI entry ─────────────────────────────────────────────────────────


def _parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument(
        "--reset",
        action="store_true",
        help="Delete demo users + cascaded rows before re-seeding.",
    )
    p.add_argument(
        "--no-rag",
        action="store_true",
        help="Skip document embedding (reserved for when document seeding is wired).",
    )
    return p.parse_args()


def main() -> None:
    args = _parse_args()
    try:
        seed(reset=args.reset, with_rag=not args.no_rag)
    except Exception:
        logger.exception("seed_demo failed")
        sys.exit(1)


if __name__ == "__main__":
    main()
