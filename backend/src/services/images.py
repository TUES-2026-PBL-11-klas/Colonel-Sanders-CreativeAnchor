from src.services.supabase import _Client

def _handle_bucket():
    res = _Client.storage.list_buckets()
    print(res)