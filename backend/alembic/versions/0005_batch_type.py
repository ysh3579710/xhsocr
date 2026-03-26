"""add batch type

Revision ID: 0005_batch_type
Revises: 0004_task_type_create
Create Date: 2026-03-18
"""

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "0005_batch_type"
down_revision = "0004_task_type_create"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("CREATE TYPE batch_type AS ENUM ('ocr', 'create')")
    op.add_column(
        "batches",
        sa.Column(
            "batch_type",
            sa.Enum("ocr", "create", name="batch_type"),
            nullable=False,
            server_default="ocr",
        ),
    )


def downgrade() -> None:
    op.drop_column("batches", "batch_type")
    op.execute("DROP TYPE IF EXISTS batch_type")
