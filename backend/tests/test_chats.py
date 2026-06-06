import io
import json
from unittest.mock import MagicMock, patch

def test_new_chat(client, mock_supabase):
    mock_res = MagicMock()
    mock_res.candidates = [
        MagicMock(content=MagicMock(parts=[MagicMock(text="Gemini response text")]))
    ]
    
    with patch("src.routes.chats._chat", return_value=mock_res) as mock_chat_fn:
        # Mock download from images bucket
        mock_supabase.storage.from_.return_value.download.return_value = b"image bytes"
        
        response = client.post("/chat", json={
            "image_uuid": "11111111-1111-1111-1111-111111111111",
            "custom_prompt": "Help me with the composition",
            "history": []
        }, headers={"Authorization": "Bearer token"})
        
        assert response.status_code == 201
        assert response.get_json() == {"text": "Gemini response text"}
        assert mock_chat_fn.called

def test_analyze_direct(client, mock_supabase):
    mock_res = MagicMock()
    mock_res.candidates = [
        MagicMock(content=MagicMock(parts=[MagicMock(text="Direct response")]))
    ]
    
    with patch("src.routes.chats._chat", return_value=mock_res) as mock_chat_fn:
        data = {
            "image": (io.BytesIO(b"fake png bytes"), "image.png"),
            "custom_prompt": "Look at my art",
            "history": json.dumps([])
        }
        response = client.post("/chat/direct", data=data, content_type="multipart/form-data", headers={"Authorization": "Bearer token"})
        
        assert response.status_code == 200
        assert response.get_json() == {"text": "Direct response"}
        assert mock_chat_fn.called

def test_get_chat_contents(client, mock_supabase):
    mock_history = [{"role": "human", "content": "hello", "created_at": "123"}]
    with patch("src.routes.chats._get_history", return_value=mock_history) as mock_hist_fn:
        response = client.get("/chat/11111111-1111-1111-1111-111111111111", headers={"Authorization": "Bearer token"})
        assert response.status_code == 200
        assert response.get_json() == {"chat": mock_history}
        assert mock_hist_fn.called

def test_new_message(client, mock_supabase):
    mock_supabase.table.return_value.insert.return_value.execute.return_value = MagicMock()
    
    response = client.post("/chat/11111111-1111-1111-1111-111111111111", json={
        "message": "follow up question"
    }, headers={"Authorization": "Bearer token"})
    
    assert response.status_code == 201

def test_get_gallery_chat(client, mock_supabase):
    # Mock database select chains
    mock_supabase.table.return_value.select.return_value.eq.return_value.execute.side_effect = [
        MagicMock(data=[{"id": "gallery-id"}]),       # galleries select
        MagicMock(data=[{"id": "entry-id"}]),         # gallery_entries select
        MagicMock(data=[{"id": "chat-id"}])           # chats select
    ]
    
    mock_history = [
        {"role": "human", "content": "Hello AI", "created_at": "2026-06-06T09:30:00Z"},
        {"role": "ai", "content": "Hello user", "created_at": "2026-06-06T09:31:00Z"}
    ]
    
    with patch("src.routes.chats._get_history", return_value=mock_history):
        response = client.get("/chat/gallery/11111111-1111-1111-1111-111111111111", headers={"Authorization": "Bearer token"})
        assert response.status_code == 200
        data = response.get_json()
        assert "history" in data
        assert len(data["history"]) == 2
        assert data["history"][0]["sender"] == "user"
        assert data["history"][1]["sender"] == "gemini"

def test_sync_gallery_chat(client, mock_supabase):
    mock_supabase.table.return_value.select.return_value.eq.return_value.execute.side_effect = [
        MagicMock(data=[{"id": "gallery-id"}]),       # galleries select
        MagicMock(data=[{"id": "entry-id"}]),         # gallery_entries select
        MagicMock(data=[{"id": "chat-id"}])           # chats select
    ]
    mock_supabase.table.return_value.delete.return_value.eq.return_value.execute.return_value = MagicMock()
    mock_supabase.table.return_value.insert.return_value.execute.return_value = MagicMock()

    sync_payload = {
        "history": [
            {"sender": "user", "message": "hello", "createdAt": "2026-06-06T09:30:00Z"},
            {"sender": "gemini", "message": "hi there", "createdAt": "2026-06-06T09:31:00Z"}
        ]
    }
    
    response = client.post("/chat/gallery/11111111-1111-1111-1111-111111111111", json=sync_payload, headers={"Authorization": "Bearer token"})
    assert response.status_code == 200
    assert response.get_json() == {"status": "ok"}

def test_delete_chat(client):
    response = client.delete("/chat/11111111-1111-1111-1111-111111111111", headers={"Authorization": "Bearer token"})
    assert response.status_code == 200
    assert response.get_json() == {"status": "ok"}
