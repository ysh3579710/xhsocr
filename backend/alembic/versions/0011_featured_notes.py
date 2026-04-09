"""add featured notes table

Revision ID: 0011_featured_notes
Revises: 0010_task_book_title_snapshot
Create Date: 2026-04-08
"""

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "0011_featured_notes"
down_revision = "0010_task_book_title_snapshot"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "featured_notes",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("source_task_type", sa.String(length=32), nullable=True),
        sa.Column("source_task_id", sa.Integer(), nullable=True),
        sa.Column("title", sa.String(length=255), nullable=False),
        sa.Column("full_text", sa.Text(), nullable=False),
        sa.Column("is_manual", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("structured_title", sa.Text(), nullable=True),
        sa.Column("structured_points_text", sa.Text(), nullable=True),
        sa.Column("structured_outline", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("source_task_type", "source_task_id", name="uq_featured_notes_source_task"),
    )
    op.create_index("ix_featured_notes_title", "featured_notes", ["title"], unique=False)
    op.create_index("ix_featured_notes_created_at", "featured_notes", ["created_at"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_featured_notes_created_at", table_name="featured_notes")
    op.drop_index("ix_featured_notes_title", table_name="featured_notes")
    op.drop_table("featured_notes")
