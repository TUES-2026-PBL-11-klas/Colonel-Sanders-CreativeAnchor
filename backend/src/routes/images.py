from flask_smorest import Blueprint
from flask import jsonify, request
from src.services.supabase import upload_image

blp = Blueprint("Images", "images", description="Images endpoints.")


@blp.route("/images/upload", methods=["POST"])
def get():
    if "image" not in request.files:
        return jsonify({'error': 'ouuu shiii no files 👀👀👀👀👀👀👀'}), 400

    file = request.files["image"]

    url = upload_image(file)

    return jsonify({"url": url})
