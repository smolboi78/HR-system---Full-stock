"""add departments - ZenHR's canonical (flat, no hierarchy) department list,
synced separately from whatever Employee.department strings show up

Revision ID: c3f7a9d2e6b1
Revises: 8a2c1e0f4b7d
Create Date: 2026-09-14 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = 'c3f7a9d2e6b1'
down_revision = '8a2c1e0f4b7d'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'departments',
        sa.Column('id', sa.String(), nullable=False),
        sa.Column('zenhr_department_id', sa.Integer(), nullable=False),
        sa.Column('zenhr_branch_id', sa.Integer(), nullable=False),
        sa.Column('name', sa.String(), nullable=False),
        sa.Column('name_ar', sa.String(), nullable=True),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('zenhr_department_id'),
    )
    op.create_index(op.f('ix_departments_zenhr_department_id'), 'departments', ['zenhr_department_id'], unique=True)
    op.create_index(op.f('ix_departments_zenhr_branch_id'), 'departments', ['zenhr_branch_id'], unique=False)


def downgrade() -> None:
    op.drop_index(op.f('ix_departments_zenhr_branch_id'), table_name='departments')
    op.drop_index(op.f('ix_departments_zenhr_department_id'), table_name='departments')
    op.drop_table('departments')
