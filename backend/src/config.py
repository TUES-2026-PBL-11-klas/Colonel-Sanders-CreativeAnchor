import os
from dotenv import load_dotenv

load_dotenv()


class Config:
    API_TITLE = "User API"
    API_VERSION = "v1"
    OPENAPI_VERSION = "3.0.3"
    OPENAPI_JSON_PATH = "openapi.json"
    OPENAPI_URL_PREFIX = "/docs"
    OPENAPI_SWAGGER_UI_PATH = "/"
    OPENAPI_SWAGGER_UI_URL = (
        "https://cdn.jsdelivr.net/npm/swagger-ui-dist/"
    )

    IMAGE_EXTENSIONS = {"png", "jpeg"}  # da dobawim oshte mozhe bi

    SUPABASE_URL = os.environ.get("SUPABASE_URL")
    SUPABASE_KEY = os.environ.get("SUPABASE_KEY")
    SUPABASE_JWT_SECRET = os.environ.get("SUPABASE_JWT_SECRET")
