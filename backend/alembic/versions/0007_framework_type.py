"""add framework task and batch type

Revision ID: 0007_framework_type
Revises: 0006_flat_prompt
Create Date: 2026-03-28
"""

from alembic import op


# revision identifiers, used by Alembic.
revision = "0007_framework_type"
down_revision = "0006_flat_prompt"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TYPE task_type ADD VALUE IF NOT EXISTS 'framework'")
    op.execute("ALTER TYPE batch_type ADD VALUE IF NOT EXISTS 'framework'")


def downgrade() -> None:
    # Postgres enum value removal is non-trivial and unsafe for downgrade in-place.
    pass

