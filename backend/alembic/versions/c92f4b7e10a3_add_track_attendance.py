"""add track_attendance

Revision ID: c92f4b7e10a3
Revises: b7e3a1c95d40
Create Date: 2026-09-16

Everyone is attendance-tracked by default; an admin turns it off for people
listed for reference who never clock in.
"""

import sqlalchemy as sa
from alembic import op

revision = "c92f4b7e10a3"
down_revision = "b7e3a1c95d40"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "employees",
        sa.Column("track_attendance", sa.Boolean(), nullable=False, server_default=sa.true()),
    )


def downgrade() -> None:
    op.drop_column("employees", "track_attendance")
