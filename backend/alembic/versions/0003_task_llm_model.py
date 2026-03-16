"""add task llm_model

Revision ID: 0003_task_llm_model
Revises: 0002_app_settings
Create Date: 2026-03-16
"""

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "0003_task_llm_model"
down_revision = "0002_app_settings"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "tasks",
        sa.Column("llm_model", sa.String(length=128), nullable=False, server_default="openai/gpt-5-mini"),
    )


def downgrade() -> None:
    op.drop_column("tasks", "llm_model")
