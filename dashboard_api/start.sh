#!/bin/bash
set -a
source ../.env.local
set +a
python3 -m uvicorn app.main:app --reload --port 8000
