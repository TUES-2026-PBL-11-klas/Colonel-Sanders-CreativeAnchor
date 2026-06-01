from flask_smorest import Blueprint
from src.schemas.ChatSchema import NewChatSchema
from flask import jsonify

blp = Blueprint("Chats", "chats", description="Chat endpoints.")


@blp.route("/chat", methods=["POST"])
@blp.arguments(NewChatSchema)
def newChat(json_data):
    image = json_data["image_uuid"]
    return jsonify({"image": image}), 201