"""add framework extract fields to task_results

Revision ID: 0008_framework_extract_fields
Revises: 0007_framework_type
Create Date: 2026-03-30
"""

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "0008_framework_extract_fields"
down_revision = "0007_framework_type"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("task_results", sa.Column("extracted_title", sa.Text(), nullable=True))
    op.add_column("task_results", sa.Column("extracted_points_text", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("task_results", "extracted_points_text")
    op.drop_column("task_results", "extracted_title")

