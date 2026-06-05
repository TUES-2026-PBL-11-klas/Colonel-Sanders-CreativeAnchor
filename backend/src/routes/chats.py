from flask_smorest import Blueprint
from src.schemas.ChatSchema import NewChatSchema, NewMessageSchema
from flask import jsonify
from src.services.supabase import _Client
from src.services.GeminiService import _chat
from src.services.auth import require_auth
import uuid

blp = Blueprint("Chats", "chats", description="Chat endpoints.")


@blp.route("/chat", methods=["POST"])
@blp.arguments(NewChatSchema)
@blp.doc(security=[{"BearerAuth": []}])
@require_auth
def newChat(json_data):

    image_uuid = json_data["image_uuid"]
    image_url = _Client.storage.from_("chat_images").get_public_url(str(image_uuid))
    image_data = _Client.storage.from_("chat_images").download(str(image_uuid))

    res = _chat(image_data)
    print(res)
    return jsonify({
        "text": res.candidates[0].content.parts[0].text
    }), 201

@blp.route("/chat/<uuid:chat_uuid>", methods=["GET"])
@blp.doc(security=[{"BearerAuth": []}])
@require_auth
def getChatContents(chat_uuid: uuid):
    res = (
        _Client.table("messages")
        .select("*")
        .eq("chat_id", chat_uuid)
        .order("created_at", desc=True)
        .execute()
    )
    return jsonify({"chat": res.data}), 200

@blp.route("/chat/<uuid:chat_uuid>", methods=["POST"])
@blp.doc(security=[{"BearerAuth": []}])
@blp.arguments(NewMessageSchema)
@require_auth
def NewMessage(json_data, chat_uuid: uuid):
    res = (
        _Client.table("messages")
        .insert({
            "chat_id": str(chat_uuid),
            "role": "human", #enum,
            "content": json_data["message"]
        })
        .execute()
    )

    #add ai prompt here?
    return jsonify({"status": "ok"}), 201
