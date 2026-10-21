import os

# boto3 needs a region at import time; set before any readmate module creates its client.
os.environ.setdefault("AWS_DEFAULT_REGION", "eu-central-1")
os.environ.setdefault("AWS_ACCESS_KEY_ID", "test")
os.environ.setdefault("AWS_SECRET_ACCESS_KEY", "test")
os.environ.setdefault("WORD_INFO_ENGINE", "fake")
