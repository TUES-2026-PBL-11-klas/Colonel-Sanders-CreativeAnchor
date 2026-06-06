from supabase import create_client, Client
import os
from dotenv import load_dotenv
import uuid
from threading import RLock

load_dotenv()

image_bucket = "images"
thumbnail_bucket = "thumbnails"

_client_lock = RLock()
_client_instance: Client | None = None
_buckets_ready = False


def setupSB() -> Client:
    supabase_url = os.environ.get("SUPABASE_URL")
    supabase_key = os.environ.get("SUPABASE_KEY")

    if not supabase_url or not supabase_key:
        raise RuntimeError("SUPABASE_URL and SUPABASE_KEY must be configured")

    return create_client(supabase_url, supabase_key)


def get_client() -> Client:
    global _client_instance

    if _client_instance is None:
        with _client_lock:
            if _client_instance is None:
                _client_instance = setupSB()

    return _client_instance


def ensure_storage_buckets():
    global _buckets_ready

    if _buckets_ready:
        return

    with _client_lock:
        if _buckets_ready:
            return

        _c = get_client()
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

        _buckets_ready = True


class LazySupabaseClient:
    def __getattr__(self, name):
        return getattr(get_client(), name)


_Client = LazySupabaseClient()


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
    ensure_storage_buckets()
    _upload_file(image, filename, user, image_bucket)
    _upload_file(thumbnail, filename, user, thumbnail_bucket)


def delete_image(file_uuid: uuid):
    res = _Client.storage.from_(image_bucket).remove([str(file_uuid)])
    return res
