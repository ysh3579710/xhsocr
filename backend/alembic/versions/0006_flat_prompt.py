"""add flat prompts and task prompt snapshot

Revision ID: 0006_flat_prompt
Revises: 0005_batch_type
Create Date: 2026-03-27
"""

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "0006_flat_prompt"
down_revision = "0005_batch_type"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "prompts",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("track", sa.String(length=64), nullable=False),
        sa.Column("name", sa.String(length=128), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("enabled", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False),
        sa.UniqueConstraint("track", "name", name="uq_prompts_track_name"),
    )
    op.create_index("ix_prompts_track", "prompts", ["track"])
    op.create_index("ix_prompts_enabled", "prompts", ["enabled"])

    op.add_column("tasks", sa.Column("prompt_id", sa.Integer(), nullable=True))
    op.add_column("tasks", sa.Column("prompt_snapshot", sa.Text(), nullable=True))
    op.create_foreign_key("fk_tasks_prompt_id", "tasks", "prompts", ["prompt_id"], ["id"], ondelete="SET NULL")
    op.create_index("ix_tasks_prompt_id", "tasks", ["prompt_id"])

    # destructive reset: existing execution/prompt history is explicitly discarded
    op.execute("TRUNCATE TABLE task_logs, task_results, task_images, tasks, batches RESTART IDENTITY CASCADE")
    op.execute("TRUNCATE TABLE prompt_versions, prompt_templates RESTART IDENTITY CASCADE")


def downgrade() -> None:
    op.drop_index("ix_tasks_prompt_id", table_name="tasks")
    op.drop_constraint("fk_tasks_prompt_id", "tasks", type_="foreignkey")
    op.drop_column("tasks", "prompt_snapshot")
    op.drop_column("tasks", "prompt_id")

    op.drop_index("ix_prompts_enabled", table_name="prompts")
    op.drop_index("ix_prompts_track", table_name="prompts")
    op.drop_table("prompts")

