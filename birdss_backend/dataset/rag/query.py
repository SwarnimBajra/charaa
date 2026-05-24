import urllib.request
import json

url = "http://127.0.0.1:8005/rag/query"
payload = {"query": "What habitat does Aquila nipalensis associate with, and what is its migration strategy?", "top_k": 3}
data = json.dumps(payload).encode("utf-8")

req = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json"}, method="POST")
try:
    with urllib.request.urlopen(req) as response:
        result = json.loads(response.read())
        print(json.dumps(result, indent=2))
except Exception as e:
    print("Error:", e)
