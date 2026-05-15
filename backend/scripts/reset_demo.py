"""Wipe just the demo accounts (and their cascaded rows).

Usage (always from `backend/`):

    .venv/bin/python scripts/reset_demo.py

Useful between dress rehearsals when one of the demo logins has gotten
into a weird state — drop the four users, the CASCADE delete on
`users.id` foreign keys takes their quizzes, attempts, resume, profile,
announcements, study optimizer rows, etc. with them.

Boss-battle Challenge rows live independently of users and are kept;
re-running `seed_demo.py` is idempotent on those.
"""
from __future__ import annotations

import logging
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from scripts.seed_demo import EMAILS, reset_demo_users  # noqa: E402

from app.core.database import SessionLocal  # noqa: E402

logging.basicConfig(level=logging.INFO, format="%(message)s")
logger = logging.getLogger("reset_demo")


def main() -> None:
    with SessionLocal() as db:
        deleted = reset_demo_users(db)
    if deleted == 0:
        logger.info("No demo users found — nothing to reset.")
    else:
        logger.info("Reset complete. Targeted accounts:")
        for label, email in EMAILS.items():
            logger.info("  %-10s %s", label, email)


if __name__ == "__main__":
    main()
