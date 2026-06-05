from marshmallow import Schema, fields
from marshmallow.validate import Length


class SignupSchema(Schema):
    email = fields.Email(required=True)
    password = fields.Str(
        required=True,
        validate=[
            Length(min=6, error="Password must be at least 6 characters.")
        ]
    )


class LoginSchema(Schema):
    email = fields.Email(required=True)
    password = fields.String(required=True, load_only=True)


class TokenRefreshSchema(Schema):
    refresh_token: str = fields.Str(required=True)


class TokenResponseSchema(Schema):
    access_token: str = fields.Str(required=True)
    refresh_token: str = fields.Str(required=True)
    # token_type is optional — login/signup don't always return it.
    token_type: str = fields.Str(
        load_default="bearer",
        dump_default="bearer",
        dump_only=True,
    )
