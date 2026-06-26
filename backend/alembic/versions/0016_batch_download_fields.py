"""add batch download fields

Revision ID: 0016_batch_download_fields
Revises: 0015_task_result_raw_output
Create Date: 2026-06-25 00:00:00.000000
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "0016_batch_download_fields"
down_revision: Union[str, Sequence[str], None] = "0015_task_result_raw_output"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("batches", sa.Column("download_count", sa.Integer(), nullable=False, server_default="0"))
    op.add_column("batches", sa.Column("last_downloaded_at", sa.DateTime(timezone=True), nullable=True))
    op.alter_column("batches", "download_count", server_default=None)


def downgrade() -> None:
    op.drop_column("batches", "last_downloaded_at")
    op.drop_column("batches", "download_count")
