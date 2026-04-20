FROM python:3.12-slim

WORKDIR /app
RUN pip install --no-cache-dir paramiko anthropic requests

COPY *.py ./
RUN mkdir -p sessions

CMD ["python", "ssh_credential_guesser.py", "--sessions", "10", "--target", "lab-honeypot"]
