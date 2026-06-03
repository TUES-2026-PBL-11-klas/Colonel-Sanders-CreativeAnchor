from supabase import create_client, Client
import os
from dotenv import load_dotenv
import uuid

load_dotenv()

_Client: Client = create_client(os.environ.get("SUPABASE_URL"), os.environ.get("SUPABASE_KEY"))
bucket_name = "chat_images"

def upload_image(file):
    filename = f'{uuid.uuid4()}'
    file_bytes = file.read()
    content_type = file.content_type 

    _Client.storage.from_(bucket_name).upload(
        path=filename,
        file = file_bytes,
        file_options={"content-type": content_type}
    )

    # public_url = _Client.storage.from_("chat_images").get_public_url(filename)

    return filename

def delete_image(file_uuid: uuid):
    res = _Client.storage.from_(bucket_name).remove([str(file_uuid)])
    return res
