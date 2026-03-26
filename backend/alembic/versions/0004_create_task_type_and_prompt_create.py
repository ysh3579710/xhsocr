"""add create task type and prompt type

Revision ID: 0004_task_type_create
Revises: 0003_task_llm_model
Create Date: 2026-03-17
"""

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "0004_task_type_create"
down_revision = "0003_task_llm_model"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TYPE prompt_type ADD VALUE IF NOT EXISTS 'create'")
    op.execute("CREATE TYPE task_type AS ENUM ('ocr', 'create')")
    op.add_column(
        "tasks",
        sa.Column(
            "task_type",
            sa.Enum("ocr", "create", name="task_type"),
            nullable=False,
            server_default="ocr",
        ),
    )
    op.add_column("tasks", sa.Column("title", sa.String(length=255), nullable=True))
    op.alter_column("tasks", "book_id", existing_type=sa.Integer(), nullable=True)


def downgrade() -> None:
    op.alter_column("tasks", "book_id", existing_type=sa.Integer(), nullable=False)
    op.drop_column("tasks", "title")
    op.drop_column("tasks", "task_type")
    op.execute("DROP TYPE IF EXISTS task_type")
