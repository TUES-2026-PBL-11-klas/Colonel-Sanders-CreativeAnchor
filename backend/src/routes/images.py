from flask_smorest import Blueprint
from flask import jsonify, request, g
from src.services.supabase import upload_image_thumbnail, delete_image
from src.services.auth import require_auth
import uuid

blp = Blueprint("Images", "images", description="Images endpoints.")


@blp.route("/images", methods=["POST"])
@blp.doc(security=[{"BearerAuth": []}])
@require_auth
def uploadImage():   
    # print(f'{g.jwt_claims}') 
    if "image" not in request.files:
        return jsonify({'error': 'File not found in request.'}), 400
    if "thumbnail" not in request.files:
        return jsonify({'error': 'Thumbnail not found in request'}), 400

    image = request.files["image"]
    thumbnail = request.files["thumbnail"]

    filename = f'{uuid.uuid4()}'
    upload_image_thumbnail(image, thumbnail, filename, g.sub_uuid)

    return jsonify({"file_uuid": filename})

@blp.route("/images/<uuid:image_uuid>", methods=["DELETE"])
@blp.doc(security=[{"BearerAuth": []}])
@require_auth
def getImageUrl(image_uuid: uuid):
    res = delete_image(image_uuid)
    if res:
        return jsonify({"status": "ok"}), 204
    else:
        return jsonify({"error": "Something went wrong."}), 500
