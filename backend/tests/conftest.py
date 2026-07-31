import os

# Must run before app.db.session (and therefore app.main) is ever imported by
# a test module, so it belongs in conftest.py rather than a fixture — pytest
# loads conftest.py during collection, ahead of the test files themselves.
# Without this, importing app.main during test collection would create a
# real ./mortgage.db file in whatever directory pytest is run from.
os.environ.setdefault("DATABASE_URL", "sqlite:///:memory:")
