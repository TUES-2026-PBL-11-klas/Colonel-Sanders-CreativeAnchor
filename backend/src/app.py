from flask import Flask
from src.extensions import api
from src.config import Config
from src.routes.images import blp as ImagesBlueprint
from src.routes.chats import blp as ChatBlueprint
from src.routes.auth import blp as AuthBlueprint


def create_app() -> Flask:
    app = Flask(__name__)

    app.config.from_object(Config)

    api.init_app(app)

    api.register_blueprint(ImagesBlueprint)
    api.register_blueprint(ChatBlueprint)
    api.register_blueprint(AuthBlueprint)

    return app
