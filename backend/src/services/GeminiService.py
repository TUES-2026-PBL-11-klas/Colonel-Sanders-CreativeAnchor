from google import genai
from google.genai import types
import io

_AIModel = "gemini-3.5-flash"

_AIClient = genai.Client()

def _chat2(url: str):
    res = _AIClient.models.generate_content(
        model=_AIModel,
        contents=[
            "Describe this image.",
            types.Part.from_uri(file_uri=url, mime_type="image/jpeg"),
        ] 
    )
    return res

def _chat(image_data):
    buffer = io.BytesIO(image_data)
    buffer.name = "image.png"
    uploaded_file = _AIClient.files.upload(
        file=buffer,
        config={"mime_type": "image/png"},
    )
    res = _AIClient.models.generate_content(
        model=_AIModel,
        contents=["Describe this image.", uploaded_file],
    )
    return res
