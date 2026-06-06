from supabase import create_client, Client
import os
from dotenv import load_dotenv
import uuid

load_dotenv()

image_bucket = "images"
thumbnail_bucket = "thumbnails"


def setupSB() -> Client:
    _c = create_client(
        os.environ.get("SUPABASE_URL"),
        os.environ.get("SUPABASE_KEY")
    )
    _buckets = {b.name for b in _c.storage.list_buckets()}

    buckets = [
        {
            "name": image_bucket,
            "options": {
                "public": True,
                "allowed_mime_types": [
                    "image/png",
                    "image/jpeg",
                    "image/vnd.adobe.photoshop",
                    "application/octet-stream",
                ],
                "file_size_limit": 200 * 1024 * 1024,
            },
        },
        {
            "name": thumbnail_bucket,
            "options": {
                "public": True,
                "allowed_mime_types": ["image/png"],
                "file_size_limit": 16 * 1024 * 1024,
            },
        },
    ]

    for bucket in buckets:
        if bucket["name"] not in _buckets:
            _c.storage.create_bucket(
                bucket["name"],
                options=bucket["options"],
            )

    return _c


_Client: Client = setupSB()


def _upload_file(file, filename, user: uuid, bucket_name):
    file_bytes = file.read()
    content_type = file.content_type or "image/png"

    _Client.storage.from_(bucket_name).upload(
        path=f'{str(user)}/{filename}',
        file=file_bytes,
        file_options={
            "content-type": content_type,
            "upsert": "true",   # prevent Duplicate errors on retries
        }
    )


def upload_image_thumbnail(image, thumbnail, filename: str, user: uuid):
    _upload_file(image, filename, user, image_bucket)
    _upload_file(thumbnail, filename, user, thumbnail_bucket)


def delete_image(file_uuid: uuid):
    res = _Client.storage.from_(image_bucket).remove([str(file_uuid)])
    return res
