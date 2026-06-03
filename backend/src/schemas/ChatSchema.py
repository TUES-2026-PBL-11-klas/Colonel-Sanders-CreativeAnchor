from marshmallow import Schema, fields
import uuid


class NewChatSchema(Schema):
    image_uuid: uuid = fields.UUID(required=True)
