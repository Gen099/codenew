"""Get forum topic IDs from Telegram group."""
import requests

BOT = "8691429460:AAFBf7KIYrsc3YwmaWj8O_sbqTn1TOYuj5c"
CHAT = "-1003879215507"

r = requests.post(f"https://api.telegram.org/bot{BOT}/getUpdates", json={"limit": 50})
data = r.json()

if not data.get("ok"):
    print("ERROR:", data)
else:
    results = data.get("result", [])
    print(f"Total updates: {len(results)}")
    seen = set()
    for u in results:
        msg = u.get("message", {})
        chat = msg.get("chat", {})
        if str(chat.get("id", "")) == CHAT:
            tid = msg.get("message_thread_id", None)
            forum = msg.get("forum_topic_created", None)
            if forum:
                print(f"  TOPIC CREATED: thread_id={tid} name={forum.get('name','?')}")
                seen.add(tid)
            elif tid and tid not in seen:
                text = str(msg.get("text", ""))[:50]
                print(f"  thread_id={tid} text={text}")
                seen.add(tid)
