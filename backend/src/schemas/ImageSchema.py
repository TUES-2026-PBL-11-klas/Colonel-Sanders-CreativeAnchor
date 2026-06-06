from marshmallow import Schema, fields, INCLUDE
from enum import Enum
import uuid


class Status(Enum):
    SYNCED = 'synced'
    PENDING = 'pending'
    LOCAL_ONLY = 'local_only'
    FAILED = 'failed'


class EntryStatus(Enum):
    IN_PROGRESS = 'in_progress'
    COMPLETED = 'completed'


class ImageMetadataSchema(Schema):
    id: uuid = fields.UUID(required=True)  # file_uuid
    fileName: str = fields.Str(required=True)
    # file_uuid: str = fields.Str(required=True)

    entryStatus = fields.Enum(EntryStatus, by_value=True, required=True)
    syncStatus = fields.Enum(Status, by_value=True, required=True)
    # "LOCAL_ONLY", trqqq promenq bazata danni
    fileHash: str = fields.Str(required=True)

    # "hoursSpent": 0, <-- ne mi hareswa towa
    # "metadata": { "sizeBytes": 230886077, "mimeType": "image/clip"},
    # tuj weche go ima w s3?
    # "deviceOrigin": "23e49f21-4e6c-409b-8e1e-ca9e55127ea0",
    # nqma go w bazite danni
    createdAt = fields.DateTime()  # "2026-04-16T19:56:15.872Z",
    updatedAt = fields.DateTime()  #: "2026-05-14T16:39:50.000Z",
    # "accessedAt": "2026-06-03T19:39:07.369Z",
    # възможно е колкото да си намеря приятелка

    # "thumbnailPath": "thumbnails/thumb_dobribobri.clip.png",
    # actually ne ni trqbwa
    # zaradi nachina po kojto se generirat

    # "needsCritique": true <-- аз викам че всичко трябва да се критикува
    class Meta:
        unknown = INCLUDE
