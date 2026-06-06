from unittest.mock import MagicMock

def test_signup(client, mock_supabase):
    # Setup mock response
    mock_session = MagicMock()
    mock_session.access_token = "access_123"
    mock_session.refresh_token = "refresh_123"
    mock_session.token_type = "bearer"
    
    mock_res = MagicMock()
    mock_res.session = mock_session
    mock_supabase.auth.sign_up.return_value = mock_res
    
    response = client.post("/signup", json={
        "email": "test@example.com",
        "password": "securepassword123"
    })
    
    assert response.status_code == 201
    data = response.get_json()
    assert data["access_token"] == "access_123"
    assert data["refresh_token"] == "refresh_123"
    assert data["token_type"] == "bearer"

def test_login(client, mock_supabase):
    mock_session = MagicMock()
    mock_session.access_token = "access_login"
    mock_session.refresh_token = "refresh_login"
    mock_session.token_type = "bearer"
    
    mock_res = MagicMock()
    mock_res.session = mock_session
    mock_supabase.auth.sign_in_with_password.return_value = mock_res
    
    response = client.post("/login", json={
        "email": "test@example.com",
        "password": "securepassword123"
    })
    
    assert response.status_code == 200
    data = response.get_json()
    assert data["access_token"] == "access_login"

def test_refresh(client, mock_supabase):
    mock_session = MagicMock()
    mock_session.access_token = "access_refreshed"
    mock_session.refresh_token = "refresh_refreshed"
    mock_session.token_type = "bearer"
    
    mock_res = MagicMock()
    mock_res.session = mock_session
    mock_supabase.auth.refresh_session.return_value = mock_res
    
    response = client.post("/refresh", json={
        "refresh_token": "old_refresh_token"
    })
    
    assert response.status_code == 200
    data = response.get_json()
    assert data["access_token"] == "access_refreshed"

def test_logout(client, mock_supabase):
    response = client.post("/logout")
    assert response.status_code == 200
    assert response.get_json() == {"message": "Logged out"}
