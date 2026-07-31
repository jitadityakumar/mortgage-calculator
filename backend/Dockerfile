FROM python:3.12-slim

RUN useradd --create-home appuser
WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app

# /data holds the SQLite file (see docker-compose.yml's bind mount) — must
# exist and be writable by appuser before persistence lands in a later phase,
# or the container gets "unable to open database file" on first write.
RUN mkdir -p /data && chown appuser:appuser /data

USER appuser
EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
