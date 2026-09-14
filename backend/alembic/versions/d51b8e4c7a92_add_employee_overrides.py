"""add per-employee job title / org group overrides, set in Settings and
layered on top of what ZenHR syncs

Revision ID: d51b8e4c7a92
Revises: c3f7a9d2e6b1
Create Date: 2026-09-14 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = 'd51b8e4c7a92'
down_revision = 'c3f7a9d2e6b1'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('employees', sa.Column('job_title_override', sa.String(), nullable=True))
    op.add_column('employees', sa.Column('org_group_override', sa.String(), nullable=True))


def downgrade() -> None:
    op.drop_column('employees', 'org_group_override')
    op.drop_column('employees', 'job_title_override')
