"""add raw_output to task_results

Revision ID: 0015_task_result_raw_output
Revises: 0014_book_attribute
Create Date: 2026-06-10 00:00:00.000000
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "0015_task_result_raw_output"
down_revision: Union[str, Sequence[str], None] = "0014_book_attribute"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("task_results", sa.Column("raw_output", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("task_results", "raw_output")
