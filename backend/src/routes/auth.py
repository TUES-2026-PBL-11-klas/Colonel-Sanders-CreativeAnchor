from flask_smorest import Blueprint
from flask import jsonify
from src.services.supabase import _Client
from src.schemas.auth_schema import (SignupSchema,
                                     TokenResponseSchema,
                                     LoginSchema,
                                     TokenRefreshSchema)

blp = Blueprint("Auth", "auth", description="Auth endpoints")


@blp.route("/signup", methods=["POST"])
@blp.arguments(SignupSchema)
@blp.response(201, TokenResponseSchema)
def signup(json_data):
    res = _Client.auth.sign_up({
        "email": json_data["email"],
        "password": json_data["password"]
    })
    return {
        "access_token": res.session.access_token,
        "refresh_token": res.session.refresh_token
    }


@blp.route("/login", methods=["POST"])
@blp.arguments(LoginSchema)
@blp.response(200, TokenResponseSchema)
def login(json_data):
    res = _Client.auth.sign_in_with_password({
        "email": json_data["email"],
        "password": json_data["password"]
    })
    return {
        "access_token": res.session.access_token,
        "refresh_token": res.session.refresh_token
    }


@blp.route("/refresh", methods=["POST"])
@blp.arguments(TokenRefreshSchema)
@blp.response(200, TokenResponseSchema)
def refresh(json_data):
    refresh_token = json_data["refresh_token"]
    try:  # i dont really think exceptions will happen
        res = _Client.auth.refresh_session(refresh_token)
        return {
            "access_token": res.session.access_token,
            "refresh_token": res.session.refresh_token,
            "token_type": res.session.token_type
        }
    except Exception:
        return jsonify({"error": "Internal server error"}), 500

# @blp.route("/logout", methods=["POST"])
# def logout():
#     _Client.auth.sign_out()
#     return jsonify({"message": "Logged out"}), 200
