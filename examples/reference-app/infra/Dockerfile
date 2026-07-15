# Container image for the Task Tracker reference app.
# Introduced at checkpoint 007 (specs/007-infra-ci-finalization.md).

FROM python:3.12-slim

WORKDIR /app
COPY backend ./backend
COPY database ./database

EXPOSE 8765
CMD ["python3", "-m", "backend.app"]
