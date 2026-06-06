import sys
import os
from unittest.mock import MagicMock

# Inject mock environments before any packages load
os.environ["SUPABASE_URL"] = "https://mock.supabase.co"
os.environ["SUPABASE_KEY"] = "mock_key"
os.environ["GEMINI_API_KEY"] = "mock_gemini_key"
os.environ["JWT_SECRET_KEY"] = "mock_jwt_secret"
os.environ["API_BASE_URL"] = "http://localhost:5000"

_Client_mock = MagicMock()
_Client_mock.auth = MagicMock()
_Client_mock.storage = MagicMock()
_Client_mock.table = MagicMock()

# Mock the storage list_buckets to prevent network call
mock_bucket_1 = MagicMock()
mock_bucket_1.name = "images"
mock_bucket_2 = MagicMock()
mock_bucket_2.name = "thumbnails"
_Client_mock.storage.list_buckets.return_value = [mock_bucket_1, mock_bucket_2]

# Mock the entire supabase module
mock_supabase_mod = MagicMock()
mock_supabase_mod.create_client.return_value = _Client_mock
sys.modules["supabase"] = mock_supabase_mod

# Mock Google GenAI client
genai_mock = MagicMock()
sys.modules["google"] = MagicMock()
sys.modules["google.genai"] = genai_mock
sys.modules["google.genai.types"] = MagicMock()

import pytest
from src.app import create_app

@pytest.fixture
def mock_supabase():
    _Client_mock.auth.get_claims.return_value = {
        "claims": {"sub": "00000000-0000-0000-0000-000000000000"}
    }
    return _Client_mock

@pytest.fixture
def app():
    # Force mock return value for Supabase init
    import src.services.supabase
    src.services.supabase._Client = _Client_mock
    
    app = create_app()
    app.config["TESTING"] = True
    app.config["DEBUG"] = False
    return app

@pytest.fixture
def client(app):
    return app.test_client()

@pytest.fixture
def authenticated_headers():
    # Return fake authorization headers that will bypass require_auth in tests
    # Note: require_auth decodes JWT or mocks user sub
    # Let's inspect src/services/auth.py to see how require_auth is implemented!
    return {"Authorization": "Bearer mock_token"}
