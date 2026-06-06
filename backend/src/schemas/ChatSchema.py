from marshmallow import Schema, fields
import uuid


class NewChatSchema(Schema):
    image_uuid: uuid = fields.UUID(required=True)
    # Optional — if omitted, GeminiService uses the system prompt alone
    custom_prompt: str = fields.Str(load_default=None)
    # Optional conversation history for multi-turn context
    history: list = fields.List(fields.Dict(), load_default=None)


class NewMessageSchema(Schema):
    message: str = fields.Str(required=True)
