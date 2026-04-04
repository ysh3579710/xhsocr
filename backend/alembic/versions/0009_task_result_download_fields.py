"""add download fields to task_results

Revision ID: 0009_task_result_download_fields
Revises: 0008_framework_extract_fields
Create Date: 2026-03-30
"""

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "0009_task_result_download_fields"
down_revision = "0008_framework_extract_fields"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("task_results", sa.Column("download_count", sa.Integer(), nullable=False, server_default="0"))
    op.add_column("task_results", sa.Column("last_downloaded_at", sa.DateTime(timezone=True), nullable=True))
    op.alter_column("task_results", "download_count", server_default=None)


def downgrade() -> None:
    op.drop_column("task_results", "last_downloaded_at")
    op.drop_column("task_results", "download_count")

