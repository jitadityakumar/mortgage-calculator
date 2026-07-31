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
