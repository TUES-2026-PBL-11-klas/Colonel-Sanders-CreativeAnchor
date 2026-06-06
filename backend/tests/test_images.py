import io
from unittest.mock import MagicMock, patch

def test_upload_image(client, mock_supabase):
    # Mock storage upload function
    with patch("src.routes.images.upload_image_thumbnail") as mock_upload:
        data = {
            "image": (io.BytesIO(b"fake image bytes"), "drawing.png"),
            "thumbnail": (io.BytesIO(b"fake thumbnail bytes"), "thumb.png")
        }
        response = client.post("/images", data=data, content_type="multipart/form-data", headers={"Authorization": "Bearer token"})
        assert response.status_code == 200
        assert "file_uuid" in response.get_json()
        assert mock_upload.called

def test_upload_metadata_new_gallery(client, mock_supabase):
    # Mock galleries table search and creation
    mock_supabase.table.return_value.select.return_value.eq.return_value.execute.side_effect = [
        MagicMock(data=[]), # no gallery found
        MagicMock(data=[{"id": "gallery-uuid-123"}]) # return gallery id after insert
    ]
    
    # Mock insert gallery entry
    mock_supabase.table.return_value.insert.return_value.execute.return_value = MagicMock(data=[{"id": "gallery-uuid-123"}])

    metadata = {
        "id": "11111111-1111-1111-1111-111111111111",
        "fileName": "my_drawing.png",
        "entryStatus": "in_progress",
        "fileHash": "abcdef123456",
        "syncStatus": "synced",
        "createdAt": "2026-06-06T09:30:00Z",
        "updatedAt": "2026-06-06T09:30:00Z"
    }

    response = client.post("/images/metadata", json=metadata, headers={"Authorization": "Bearer token"})
    assert response.status_code == 200
    assert response.get_json() == {"status": "ok"}

def test_get_images(client, mock_supabase):
    # Mock galleries select
    mock_supabase.table.return_value.select.return_value.eq.return_value.execute.side_effect = [
        MagicMock(data=[{"id": "gallery-uuid"}]), # gallery found
        MagicMock(data=[{"id": "entry-1", "file_name": "pic.png"}]) # gallery entries list
    ]

    response = client.get("/images", headers={"Authorization": "Bearer token"})
    assert response.status_code == 200
    data = response.get_json()
    assert len(data) == 1
    assert data[0]["file_name"] == "pic.png"

def test_get_thumbnail(client, mock_supabase):
    # Mock storage download
    mock_supabase.storage.from_.return_value.download.return_value = b"raw PNG bytes"
    
    response = client.get("/images/11111111-1111-1111-1111-111111111111/thumbnail", headers={"Authorization": "Bearer token"})
    assert response.status_code == 200
    assert response.data == b"raw PNG bytes"
    assert response.headers["Content-Type"] == "image/png"

def test_delete_image(client, mock_supabase):
    # Mock storage delete
    with patch("src.routes.images.delete_image", return_value=True) as mock_del:
        response = client.delete("/images/11111111-1111-1111-1111-111111111111", headers={"Authorization": "Bearer token"})
        assert response.status_code == 204
        assert mock_del.called
