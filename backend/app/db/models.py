from datetime import datetime, timezone

from sqlalchemy import Column, DateTime, Integer, String, Text

from .session import Base


class SavedCalculation(Base):
    __tablename__ = "saved_calculations"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    # Stores MortgageInputs as JSON — inputs only, never the computed result.
    # See migration.md "Recompute vs cache": recomputing on load keeps a
    # saved calculation consistent with the backend's current config
    # defaults instead of silently going stale after a config tweak.
    inputs_json = Column(Text, nullable=False)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), nullable=False)


class DefaultsConfig(Base):
    __tablename__ = "defaults_config"

    # Always id=1 — a single-row table, not one row per user (this app has
    # no accounts). Stores a MortgageDefaults JSON blob, mirroring
    # SavedCalculation.inputs_json's pattern, so adding a field later needs
    # no schema migration.
    id = Column(Integer, primary_key=True)
    defaults_json = Column(Text, nullable=False)
    updated_at = Column(
        DateTime,
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
        nullable=False,
    )
