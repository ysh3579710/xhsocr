"""add llm_model to prompts

Revision ID: 0012_prompt_llm_model
Revises: 0011_featured_notes
Create Date: 2026-06-02
"""

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "0012_prompt_llm_model"
down_revision = "0011_featured_notes"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("prompts", sa.Column("llm_model", sa.String(length=128), nullable=True))


def downgrade() -> None:
    op.drop_column("prompts", "llm_model")
