"""add attribute to books

Revision ID: 0014_book_attribute
Revises: 0013_prompt_attribute
Create Date: 2026-06-02
"""

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "0014_book_attribute"
down_revision = "0013_prompt_attribute"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("books", sa.Column("attribute", sa.String(length=64), nullable=True))


def downgrade() -> None:
    op.drop_column("books", "attribute")
