from flask_smorest import Blueprint
from flask import jsonify, request
from src.services.supabase import upload_image, delete_image
import uuid

blp = Blueprint("Images", "images", description="Images endpoints.")


@blp.route("/images", methods=["POST"])
def get():
    if "image" not in request.files:
        return jsonify({'error': 'File not found in request.'}), 400

    file = request.files["image"]

    file_uuid = upload_image(file)

    return jsonify({"file_uuid": file_uuid})


@blp.route("/images/<uuid:image_uuid>", methods=["DELETE"])
def getImageUrl(image_uuid: uuid):
    res = delete_image(image_uuid)
    if res:
        return jsonify({"status": "ok"}), 204
    else:
        return jsonify({"error": "Something went wrong."}), 500
