from flask_smorest import Blueprint
from flask import jsonify, request, g, make_response
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

    try:
        file_uuid = uuid.uuid4()
        filename = f'{file_uuid}'
        upload_image_thumbnail(image, thumbnail, filename, g.sub_uuid)
        return jsonify({"file_uuid": filename})
    except Exception as e:
        print(f"[UPLOAD ERROR] {type(e).__name__}: {e}")
        return jsonify({'error': f'Storage upload failed: {str(e)}'}), 500


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

    created_at = json_data["createdAt"]
    created_at_val = (
        created_at.isoformat()
        if created_at
        else datetime.now().isoformat()
    )

    updated_at = json_data["updatedAt"]
    updated_at_val = (
        updated_at.isoformat()
        if updated_at
        else datetime.now().isoformat()
    )

    _Client.table("gallery_entries").insert({
        "id": str(json_data["id"]),
        "gallery_id": gallery_id,
        "file_name": json_data["fileName"],
        "status": json_data["entryStatus"].value,
        "file_hash_sha256": json_data["fileHash"],
        "is_compressed": False,
        "sync_status": json_data["syncStatus"].value,
        "retry_count": 0,
        "created_at": created_at_val,
        "last_modified_at": updated_at_val
    }).execute()

    return jsonify({"status": "ok"})


@blp.route("/images", methods=["GET"])
@blp.doc(security=[{"BearerAuth": []}])
@require_auth
def getImages():
    user_id = str(g.sub_uuid)

    # Find user gallery
    gallery = (
        _Client.table("galleries")
        .select("id")
        .eq("user_id", user_id)
        .execute()
    )

    if not gallery.data:
        return jsonify([])

    gallery_id = gallery.data[0]["id"]

    # Fetch all entries in this gallery
    res = (
        _Client.table("gallery_entries")
        .select("*")
        .eq("gallery_id", gallery_id)
        .execute()
    )

    return jsonify(res.data)


@blp.route("/images/<uuid:image_uuid>/thumbnail", methods=["GET"])
@blp.doc(security=[{"BearerAuth": []}])
@require_auth
def getThumbnail(image_uuid: uuid):
    try:
        user_id = str(g.sub_uuid)
        thumb_data = _Client.storage.from_("thumbnails").download(
            f"{user_id}/{str(image_uuid)}"
        )
        response = make_response(thumb_data)
        response.headers.set('Content-Type', 'image/png')
        return response
    except Exception as e:
        print(f"[THUMBNAIL ERROR] {type(e).__name__}: {e}")
        return jsonify({"error": str(e)}), 404


@blp.route("/images/<uuid:image_uuid>", methods=["DELETE"])
@blp.doc(security=[{"BearerAuth": []}])
@require_auth
def getImageUrl(image_uuid: uuid):
    res = delete_image(image_uuid)
    if res:
        return jsonify({"status": "ok"}), 204
    else:
        return jsonify({"error": "Something went wrong."}), 500
