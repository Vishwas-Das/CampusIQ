"""One-shot seed: populates a quiz + extra student + attempts + XP.

Run after `Base.metadata.create_all()` is done. Safe to re-run — checks
for existing rows before inserting.

    .venv/Scripts/python.exe -m scripts.seed_demo_data
"""
from __future__ import annotations

import sys
from pathlib import Path

# Allow `python -m scripts.seed_demo_data` from backend/
BACKEND = Path(__file__).resolve().parents[1]
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.database import Base
from app.core.security import hash_password
from app.models.user import User, UserRole, StudentProfile, Subject
from app.models.quiz import Difficulty, Question, QuestionType, Quiz, QuizAttempt
from app.models.gamification import XPEvent, XPEventType
from sqlalchemy import create_engine


QUESTIONS = [
    {
        "q": "What does TCP stand for?",
        "options": ["Transmission Control Protocol", "Transport Control Procedure", "Type Coded Packet", "Timed Channel Path"],
        "correct": "Transmission Control Protocol",
        "topic": "Transport Layer",
    },
    {
        "q": "Which OSI layer is responsible for routing?",
        "options": ["Data Link", "Network", "Transport", "Application"],
        "correct": "Network",
        "topic": "OSI Model",
    },
    {
        "q": "Default HTTPS port?",
        "options": ["80", "8080", "443", "22"],
        "correct": "443",
        "topic": "Application Layer",
    },
    {
        "q": "Which protocol resolves a domain name to an IP?",
        "options": ["FTP", "DHCP", "DNS", "ARP"],
        "correct": "DNS",
        "topic": "Application Layer",
    },
    {
        "q": "What is the broadcast MAC address?",
        "options": ["00:00:00:00:00:00", "FF:FF:FF:FF:FF:FF", "AA:AA:AA:AA:AA:AA", "FE:80::"],
        "correct": "FF:FF:FF:FF:FF:FF",
        "topic": "Data Link Layer",
    },
]


def get_or_create_student(db: Session, *, email: str, full_name: str, password: str) -> User:
    user = db.scalar(select(User).where(User.email == email))
    if user:
        print(f"  found existing user: {email}")
        return user
    user = User(
        email=email,
        full_name=full_name,
        hashed_password=hash_password(password),
        role=UserRole.STUDENT,
        is_active=True,
    )
    db.add(user)
    db.flush()
    db.add(StudentProfile(user_id=user.id))
    print(f"  created new student: {email} (password: {password})")
    return user


def main() -> None:
    engine = create_engine(get_settings().database_url)
    with Session(engine) as db:
        # 1. Find teacher
        teacher = db.scalar(select(User).where(User.email == "boss@gmail.com"))
        if not teacher or teacher.role != UserRole.TEACHER:
            print("ERROR: teacher boss@gmail.com not found. Sign up first.")
            sys.exit(1)
        print(f"Teacher: {teacher.full_name} <{teacher.email}>")

        # 2. Find subject
        subject = db.scalar(select(Subject).where(Subject.code == "CY01234"))
        if not subject:
            print("ERROR: subject CY01234 (COMPUTER NETWORKS) not found.")
            sys.exit(1)
        print(f"Subject: {subject.code} - {subject.name}")

        # 3. Create quiz if it doesn't exist
        quiz = db.scalar(
            select(Quiz).where(
                Quiz.subject_id == subject.id,
                Quiz.title == "Networking Basics",
            )
        )
        if quiz:
            print(f"Quiz already exists: {quiz.title}")
        else:
            quiz = Quiz(
                subject_id=subject.id,
                created_by_id=teacher.id,
                title="Networking Basics",
                description="Seeded demo quiz — covers TCP/IP, OSI, DNS, ports, MAC.",
                difficulty=Difficulty.EASY,
                time_limit_minutes=10,
                is_published=True,
                is_ai_generated=False,
            )
            db.add(quiz)
            db.flush()
            for idx, q in enumerate(QUESTIONS):
                db.add(Question(
                    quiz_id=quiz.id,
                    order_index=idx,
                    question_text=q["q"],
                    question_type=QuestionType.MCQ,
                    options=q["options"],
                    correct_answer=q["correct"],
                    topic=q["topic"],
                    difficulty=Difficulty.EASY,
                ))
            print(f"Created quiz: {quiz.title} with {len(QUESTIONS)} questions, PUBLISHED")

        # 4. Students
        print("Students:")
        student1 = get_or_create_student(
            db, email="hello@gmail.com", full_name="hello", password="placeholder_existing"
        )
        student2 = get_or_create_student(
            db, email="tom@gmail.com", full_name="Tom Watson", password="Test1234!"
        )

        # 5. Attempts (only if none exist for this quiz)
        existing_attempts = db.scalar(
            select(QuizAttempt).where(QuizAttempt.quiz_id == quiz.id).limit(1)
        )
        if existing_attempts:
            print("Attempts already exist for this quiz — skipping.")
        else:
            db.refresh(quiz)
            questions = sorted(quiz.questions, key=lambda q: q.order_index)

            # Student 1: gets Q1-Q4 right, Q5 wrong  → 80%, bitvec 11110
            ans1 = []
            for i, q in enumerate(questions):
                is_correct = i < 4
                ans1.append({
                    "question_id": str(q.id),
                    "student_answer": q.correct_answer if is_correct else q.options[0],
                    "is_correct": is_correct,
                    "topic": q.topic,
                })
            db.add(QuizAttempt(
                quiz_id=quiz.id,
                student_id=student1.id,
                score=80.0,
                total_questions=5,
                correct_count=4,
                time_taken_seconds=240,
                answers=ans1,
                answer_bit_vector="11110",
            ))
            print(f"  attempt: hello scored 80% (4/5)")

            # Student 2: same as Student 1 on Q1-Q3, wrong on Q4 & Q5 → 60%, bitvec 11100
            ans2 = []
            for i, q in enumerate(questions):
                is_correct = i < 3
                ans2.append({
                    "question_id": str(q.id),
                    "student_answer": q.correct_answer if is_correct else q.options[0],
                    "is_correct": is_correct,
                    "topic": q.topic,
                })
            db.add(QuizAttempt(
                quiz_id=quiz.id,
                student_id=student2.id,
                score=60.0,
                total_questions=5,
                correct_count=3,
                time_taken_seconds=300,
                answers=ans2,
                answer_bit_vector="11100",
            ))
            print(f"  attempt: tom scored 60% (3/5)")

            # XP events
            for student, xp in [(student1, 80), (student2, 60)]:
                db.add(XPEvent(
                    student_id=student.id,
                    event_type=XPEventType.QUIZ_COMPLETED,
                    xp_earned=xp,
                    streak_multiplier=1.0,
                    reference_id=quiz.id,
                ))
            print("  XP events logged")

        db.commit()
        print("\nSeed complete.")


if __name__ == "__main__":
    main()
