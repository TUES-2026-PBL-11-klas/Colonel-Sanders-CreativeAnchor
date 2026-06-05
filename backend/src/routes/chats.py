from flask_smorest import Blueprint
from src.schemas.ChatSchema import NewChatSchema, NewMessageSchema
from flask import jsonify, g, request
from src.services.supabase import _Client
from src.services.GeminiService import _chat, _get_history
from src.services.auth import require_auth
import uuid
import json

blp = Blueprint("Chats", "chats", description="Chat endpoints.")


@blp.route("/chat", methods=["POST"])
@blp.arguments(NewChatSchema)
@blp.doc(security=[{"BearerAuth": []}])
@require_auth
def newChat(json_data):
    image_uuid = json_data["image_uuid"]
    custom_prompt = json_data.get("custom_prompt")
    history = json_data.get("history")

    # Download from the correct bucket and path.
    # Images are uploaded to the 'images' bucket at path '{user_uuid}/{image_uuid}'.
    image_data = _Client.storage.from_("images").download(f"{g.sub_uuid}/{str(image_uuid)}")

    res = _chat(image_data, custom_prompt=custom_prompt, history=history)
    return jsonify({
        "text": res.candidates[0].content.parts[0].text
    }), 201


@blp.route("/chat/direct", methods=["POST"])
@blp.doc(security=[{"BearerAuth": []}])
@require_auth
def analyzeDirect():
    """Accepts image bytes directly in the request body — no Supabase storage needed."""
    if "image" not in request.files:
        return jsonify({'error': 'image file is required'}), 400

    image_data = request.files["image"].read()
    custom_prompt = request.form.get("custom_prompt")

    history_raw = request.form.get("history")
    history = json.loads(history_raw) if history_raw else None

    try:
        res = _chat(image_data, custom_prompt=custom_prompt, history=history)
        return jsonify({
            "text": res.candidates[0].content.parts[0].text
        }), 200
    except Exception as e:
        print(f"[CHAT/DIRECT ERROR] {type(e).__name__}: {e}")
        return jsonify({'error': str(e)}), 500

@blp.route("/chat/<uuid:chat_uuid>", methods=["GET"])
@blp.doc(security=[{"BearerAuth": []}])
@require_auth
def getChatContents(chat_uuid: uuid):
    return jsonify({"chat": _get_history(chat_uuid=chat_uuid)}), 200

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
