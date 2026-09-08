"""drop onboarding_status - employees synced from ZenHR are pre-existing,
not new hires needing confirmation; category comes straight from the
department/job-title rules instead

Revision ID: 8a2c1e0f4b7d
Revises: f199520fd199
Create Date: 2026-09-08 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = '8a2c1e0f4b7d'
down_revision = 'f199520fd199'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_column('employees', 'onboarding_status')


def downgrade() -> None:
    op.add_column(
        'employees',
        sa.Column('onboarding_status', sa.VARCHAR(), nullable=False, server_default='ACTIVE'),
    )
    op.alter_column('employees', 'onboarding_status', server_default=None)
