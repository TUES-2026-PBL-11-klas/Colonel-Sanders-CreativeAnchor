from flask_smorest import Blueprint
from src.schemas.ChatSchema import NewChatSchema
from flask import jsonify
from src.services.supabase import _Client
from src.services.GeminiService import _chat2, _chat

blp = Blueprint("Chats", "chats", description="Chat endpoints.")


@blp.route("/chat", methods=["POST"])
@blp.arguments(NewChatSchema)
def newChat(json_data):

    image_uuid = json_data["image_uuid"]
    image_url = _Client.storage.from_("chat_images").get_public_url(str(image_uuid))
    image_data = _Client.storage.from_("chat_images").download(str(image_uuid))

    # res = _chat2(image_url)
    res = _chat(image_data)
    print(res)
    # return jsonify({"image": res}), 201
    # return res, 200
    return jsonify({
        "text": res.candidates[0].content.parts[0].text
    }), 201