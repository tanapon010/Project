#!/bin/sh
source .venv/bin/activate
export FLASK_APP=app.py
export FLASK_DEBUG=1
python -m flask run -p ${PORT:-8080}
