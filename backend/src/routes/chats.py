from flask_smorest import Blueprint
from src.schemas.ChatSchema import NewChatSchema, NewMessageSchema
from flask import jsonify, g, request
from src.services.supabase import _Client
from src.services.GeminiService import _chat, _get_history
from src.services.auth import require_auth
import uuid
import json
from datetime import datetime

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
    # Images are uploaded to the 'images' bucket
    # at path '{user_uuid}/{image_uuid}'.
    image_data = _Client.storage.from_("images").download(
        f"{g.sub_uuid}/{str(image_uuid)}"
    )

    res = _chat(image_data, custom_prompt=custom_prompt, history=history)
    return jsonify({
        "text": res.candidates[0].content.parts[0].text
    }), 201


@blp.route("/chat/direct", methods=["POST"])
@blp.doc(security=[{"BearerAuth": []}])
@require_auth
def analyzeDirect():
    """Accepts image bytes directly in the request body
    — no Supabase storage needed."""
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
    _Client.table("messages").insert({
        "chat_id": str(chat_uuid),
        "role": "human",  # enum
        "content": json_data["message"]
    }).execute()


@blp.route("/chat/gallery/<uuid:gallery_entry_id>", methods=["GET"])
@blp.doc(security=[{"BearerAuth": []}])
@require_auth
def getGalleryChat(gallery_entry_id: uuid):
    user_id = str(g.sub_uuid)

    # Verify gallery entry belongs to user's gallery
    gallery = (
        _Client.table("galleries")
        .select("id")
        .eq("user_id", user_id)
        .execute()
    )
    if not gallery.data:
        return jsonify({"history": []})

    gallery_id = gallery.data[0]["id"]
    entry = (
        _Client.table("gallery_entries")
        .select("id")
        .eq("id", str(gallery_entry_id))
        .eq("gallery_id", gallery_id)
        .execute()
    )
    if not entry.data:
        return jsonify({"history": []})

    # Find the chat
    chat_res = (
        _Client.table("chats")
        .select("id")
        .eq("gallery_entry_id", str(gallery_entry_id))
        .execute()
    )
    if not chat_res.data:
        return jsonify({"history": []})

    chat_id = chat_res.data[0]["id"]

    # Get messages
    messages = _get_history(chat_uuid=chat_id)

    # Format messages
    formatted = []
    for msg in messages:
        formatted.append({
            "sender": "user" if msg["role"] == "human" else "gemini",
            "message": msg["content"],
            "createdAt": msg["created_at"]
        })
    return jsonify({"history": formatted})


@blp.route("/chat/gallery/<uuid:gallery_entry_id>", methods=["POST"])
@blp.doc(security=[{"BearerAuth": []}])
@require_auth
def syncGalleryChat(gallery_entry_id: uuid):
    user_id = str(g.sub_uuid)
    json_data = request.json or {}
    history = json_data.get("history", [])

    # Get user gallery_id
    gallery = (
        _Client.table("galleries")
        .select("id")
        .eq("user_id", user_id)
        .execute()
    )
    if not gallery.data:
        return jsonify({"error": "Gallery not found"}), 404

    gallery_id = gallery.data[0]["id"]

    # Check entry
    entry = (
        _Client.table("gallery_entries")
        .select("id")
        .eq("id", str(gallery_entry_id))
        .eq("gallery_id", gallery_id)
        .execute()
    )
    if not entry.data:
        return jsonify({"error": "Gallery entry not found"}), 404

    # Get or create chat
    chat_res = (
        _Client.table("chats")
        .select("id")
        .eq("gallery_entry_id", str(gallery_entry_id))
        .execute()
    )
    if not chat_res.data:
        chat_insert = (
            _Client.table("chats")
            .insert({"gallery_entry_id": str(gallery_entry_id)})
            .execute()
        )
        chat_id = chat_insert.data[0]["id"]
    else:
        chat_id = chat_res.data[0]["id"]

    # Clear existing messages for this chat
    _Client.table("messages").delete().eq("chat_id", chat_id).execute()

    # Insert new messages
    db_messages = []
    for msg in history:
        db_messages.append({
            "chat_id": chat_id,
            "role": "human" if msg.get("sender") == "user" else "ai",
            "content": msg.get("message"),
            "created_at": msg.get("createdAt") or datetime.now().isoformat()
        })

    if db_messages:
        _Client.table("messages").insert(db_messages).execute()

    return jsonify({"status": "ok"})


@blp.route("/chat/<uuid:chat_uuid>", methods=["DELETE"])
@blp.doc(security=[{"BearerAuth": []}])
@require_auth
def deleteChat(chat_uuid: uuid):
    # Added fallback dummy endpoint to ensure API spec consistency
    return jsonify({"status": "ok"}), 200
