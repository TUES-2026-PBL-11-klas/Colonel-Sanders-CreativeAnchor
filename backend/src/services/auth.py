import functools
import os
from flask import request, jsonify, g
from src.services.supabase import _Client
from supabase_auth.errors import AuthInvalidJwtError


def require_auth(f):
    @functools.wraps(f)
    def decorated(*args, **kwargs):
        auth_header = request.headers.get("Authorization", "")
        if not auth_header.startswith("Bearer "):
            return jsonify({"error": "Missing token"}), 401

        token = auth_header.split(" ")[1]

        try:
            res = _Client.auth.get_claims(token)
            g.jwt_claims = res
            g.sub_uuid = res["claims"]["sub"]
        except AuthInvalidJwtError:
            return jsonify({"error": "Invalid token"}), 401
        except Exception as e:
            return jsonify({"error": "Auth failed"}), 401

        return f(*args, **kwargs)
    return decorated
