"""add book title snapshot to tasks

Revision ID: 0010_task_book_title_snapshot
Revises: 0009_task_result_download_fields
Create Date: 2026-03-31
"""

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "0010_task_book_title_snapshot"
down_revision = "0009_task_result_download_fields"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("tasks", sa.Column("book_title_snapshot", sa.String(length=255), nullable=True))


def downgrade() -> None:
    op.drop_column("tasks", "book_title_snapshot")

