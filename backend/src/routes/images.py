from flask_smorest import Blueprint
from flask import jsonify, request, g
from src.services.supabase import upload_image_thumbnail, delete_image, _Client
from src.services.auth import require_auth
from src.schemas.ImageSchema import ImageMetadataSchema
import uuid
from datetime import datetime

blp = Blueprint("Images", "images", description="Images endpoints.")


@blp.route("/images", methods=["POST"])
@blp.doc(security=[{"BearerAuth": []}])
@require_auth
def uploadImage():   
    if "image" not in request.files:
        return jsonify({'error': 'File not found in request.'}), 400
    if "thumbnail" not in request.files:
        return jsonify({'error': 'Thumbnail not found in request'}), 400

    image = request.files["image"]
    thumbnail = request.files["thumbnail"]

    file_uuid = uuid.uuid4()
    filename = f'{file_uuid}'
    upload_image_thumbnail(image, thumbnail, filename, g.sub_uuid)

    return jsonify({"file_uuid": filename})

@blp.route("/images/metadata", methods=["POST"])
@blp.doc(security=[{"BearerAuth": []}])
@blp.arguments(ImageMetadataSchema)
@require_auth
def uploadMetadata(json_data):
    user_id = str(g.sub_uuid)
    
    # Get or create gallery for user
    gallery = (
        _Client.table("galleries")
        .select("id")
        .eq("user_id", user_id)
        .execute()
    )
    
    if not gallery.data:
        # Create a new gallery for this user
        gallery_result = (
            _Client.table("galleries")
            .insert({"user_id": user_id})
            .execute()
        )
        gallery_id = gallery_result.data[0]["id"]
    else:
        gallery_id = gallery.data[0]["id"]
    
    res = (
        _Client.table("gallery_entries")
        .insert({
            "id": str(json_data["id"]),
            "gallery_id": gallery_id,
            "file_name": json_data["fileName"],
            "status": json_data["entryStatus"].value,
            "file_hash_sha256": json_data["fileHash"],
            "is_compressed": False,
            "sync_status": json_data["syncStatus"].value,
            "retry_count": 0,
            "created_at": datetime.now().isoformat(),
            "last_modified_at": datetime.now().isoformat()
        })
        .execute()
    )
    
    return jsonify({"status": "ok"})


@blp.route("/images/<uuid:image_uuid>", methods=["DELETE"])
@blp.doc(security=[{"BearerAuth": []}])
@require_auth
def getImageUrl(image_uuid: uuid):
    res = delete_image(image_uuid)
    if res:
        return jsonify({"status": "ok"}), 204
    else:
        return jsonify({"error": "Something went wrong."}), 500
