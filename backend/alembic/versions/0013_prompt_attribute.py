"""add attribute to prompts

Revision ID: 0013_prompt_attribute
Revises: 0012_prompt_llm_model
Create Date: 2026-06-02
"""

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "0013_prompt_attribute"
down_revision = "0012_prompt_llm_model"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("prompts", sa.Column("attribute", sa.String(length=64), nullable=True))


def downgrade() -> None:
    op.drop_column("prompts", "attribute")
