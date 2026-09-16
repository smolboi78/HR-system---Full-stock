"""add org_section_override and directory_confirmed

Revision ID: b7e3a1c95d40
Revises: d51b8e4c7a92
Create Date: 2026-09-16

Existing employees default to unconfirmed, so the directory starts empty and
every current employee is listed in Settings for an admin to place.
"""

import sqlalchemy as sa
from alembic import op

revision = "b7e3a1c95d40"
down_revision = "d51b8e4c7a92"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("employees", sa.Column("org_section_override", sa.String(), nullable=True))
    op.add_column(
        "employees",
        sa.Column(
            "directory_confirmed",
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),
    )


def downgrade() -> None:
    op.drop_column("employees", "directory_confirmed")
    op.drop_column("employees", "org_section_override")
