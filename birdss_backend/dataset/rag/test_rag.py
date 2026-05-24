import urllib.request
import urllib.error
import json

BASE_URL = "http://127.0.0.1:8002"

def main():
    print("1. Checking Status...")
    try:
        req = urllib.request.urlopen(f"{BASE_URL}/rag/status")
        print("Status:", json.loads(req.read()))
    except Exception as e:
        print("Error checking status:", e)

    print("\n2. Triggering Ingestion...")
    try:
        req = urllib.request.Request(f"{BASE_URL}/rag/ingest", method="POST")
        response = urllib.request.urlopen(req)
        print("Ingest:", json.loads(response.read()))
    except Exception as e:
        print("Error triggering ingestion:", e)

    print("\n3. Checking Status Again...")
    try:
        req = urllib.request.urlopen(f"{BASE_URL}/rag/status")
        print("Status:", json.loads(req.read()))
    except Exception as e:
        print("Error checking status:", e)

    print("\n4. Querying...")
    query = {"query": "What are the localities where Spiny Babbler is found? What family does it belong to?", "top_k": 3}
    try:
        req = urllib.request.Request(
            f"{BASE_URL}/rag/query", 
            data=json.dumps(query).encode("utf-8"), 
            headers={"Content-Type": "application/json"},
            method="POST"
        )
        response = urllib.request.urlopen(req)
        print("Query Response:", json.dumps(json.loads(response.read()), indent=2))
    except Exception as e:
        print("Error querying:", e)

if __name__ == "__main__":
    main()
