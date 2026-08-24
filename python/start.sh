#!/bin/bash
source venv/bin/activate
uvicorn resolver.main:app --port 8001 --reload
