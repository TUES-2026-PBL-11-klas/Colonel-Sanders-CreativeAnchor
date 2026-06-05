from marshmallow import Schema, fields
import uuid


class NewChatSchema(Schema):
    image_uuid: uuid = fields.UUID(required=True)


class NewMessageSchema(Schema):
    message: str = fields.Str(required=True)
