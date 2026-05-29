from flask_smorest import Blueprint
from flask import jsonify

blp = Blueprint("Images", "images", description="Images endpoints.")

@blp.route("/images/upload", methods=["POST"])
def get():
    return jsonify({"status": "ok"})