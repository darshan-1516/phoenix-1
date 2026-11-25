from datetime import datetime, timezone

from sqlalchemy import DateTime, Float, ForeignKey, Integer, JSON, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .database import Base


def utc_now():
    return datetime.now(timezone.utc)


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    username: Mapped[str] = mapped_column(String(80), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    role: Mapped[str] = mapped_column(String(20), default="analyst")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    experiments: Mapped[list["Experiment"]] = relationship(back_populates="owner")


class AppSetting(Base):
    __tablename__ = "app_settings"

    key: Mapped[str] = mapped_column(String(50), primary_key=True)
    value: Mapped[dict] = mapped_column(JSON)


class Experiment(Base):
    __tablename__ = "experiments"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    title: Mapped[str] = mapped_column(String(160), default="Prompt experiment")
    original_prompt: Mapped[str] = mapped_column(Text)
    protected_spans: Mapped[list] = mapped_column(JSON, default=list)
    test_cases: Mapped[list] = mapped_column(JSON, default=list)
    variants: Mapped[list] = mapped_column(JSON, default=list)
    model: Mapped[str] = mapped_column(String(100))
    threshold: Mapped[float] = mapped_column(Float, default=95.0)
    input_price: Mapped[float] = mapped_column(Float, default=0.0)
    output_price: Mapped[float] = mapped_column(Float, default=0.0)
    compression_mode: Mapped[str] = mapped_column(String(20), default="rules")
    original_token_count: Mapped[int] = mapped_column(Integer, default=0)
    compressed_token_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    tokens_saved: Mapped[int] = mapped_column(Integer, default=0)
    compression_pct: Mapped[float] = mapped_column(Float, default=0.0)
    equivalence_score: Mapped[float | None] = mapped_column(Float, nullable=True)
    rule_score: Mapped[float | None] = mapped_column(Float, nullable=True)
    decision: Mapped[str] = mapped_column(String(20), default="PENDING")
    cost_saved: Mapped[float] = mapped_column(Float, default=0.0)
    result: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, index=True)
    owner: Mapped[User] = relationship(back_populates="experiments")
