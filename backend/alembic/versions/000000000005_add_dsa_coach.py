"""add dsa_coach chat type + coding_problem_id + leetcode_url

Phase 1 of the DSA Coach feature:
- Adds `dsa_coach` to the `chat_type` Postgres enum. On SQLite the enum is a
  plain VARCHAR with no CHECK constraint (SQLAlchemy 1.4+ default), so the new
  value needs no DDL there — this is a no-op on SQLite.
- Adds nullable `chat_sessions.coding_problem_id` (FK -> coding_problems.id,
  ON DELETE SET NULL) so a coach conversation can be bound to one problem.
- Adds nullable `coding_problems.leetcode_url` for the "Open on LeetCode" button.

The two `add_column` calls run on BOTH dialects (SQLite supports
`ALTER TABLE ADD COLUMN` for nullable columns). The named FK constraint is only
created on Postgres — SQLite can't add a constraint via ALTER, but the ORM
relationship works from the column alone.

Revision ID: 000000000005
Revises: 000000000004
Create Date: 2026-06-07 00:00:00.000000
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "000000000005"
down_revision: Union[str, Sequence[str], None] = "000000000004"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    dialect = bind.dialect.name

    # Extend the chat_type enum on Postgres (no-op on SQLite — plain VARCHAR).
    if dialect == "postgresql":
        op.execute("ALTER TYPE chat_type ADD VALUE IF NOT EXISTS 'dsa_coach'")

    # Bind a coach session to a coding problem.
    op.add_column(
        "chat_sessions",
        sa.Column("coding_problem_id", sa.UUID(), nullable=True),
    )
    op.create_index(
        "ix_chat_sessions_coding_problem_id",
        "chat_sessions",
        ["coding_problem_id"],
    )
    if dialect == "postgresql":
        op.create_foreign_key(
            "fk_chat_sessions_coding_problem_id",
            "chat_sessions",
            "coding_problems",
            ["coding_problem_id"],
            ["id"],
            ondelete="SET NULL",
        )

    # LeetCode redirect URL for the problem.
    op.add_column(
        "coding_problems",
        sa.Column("leetcode_url", sa.String(length=300), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("coding_problems", "leetcode_url")

    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        op.drop_constraint(
            "fk_chat_sessions_coding_problem_id", "chat_sessions", type_="foreignkey"
        )
    op.drop_index("ix_chat_sessions_coding_problem_id", table_name="chat_sessions")
    op.drop_column("chat_sessions", "coding_problem_id")
