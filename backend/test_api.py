"""Test TTS API endpoints"""
import requests
import time

BASE_URL = "http://127.0.0.1:8000"

print("Testing TTS API...")

# Check initial status
print("\n1. Initial status:")
r = requests.get(f"{BASE_URL}/tts/status")
print(f"   {r.json()}")

# Start speaking
print("\n2. Starting speech...")
r = requests.post(f"{BASE_URL}/tts/speak", json={
    "text": "Hello, this is a test of the Kiosk Scholar narration feature. It should speak for several seconds."
})
print(f"   Response: {r.json()}")

# Check status repeatedly
print("\n3. Checking status over time:")
for i in range(15):
    time.sleep(0.5)
    r = requests.get(f"{BASE_URL}/tts/status")
    data = r.json()
    print(f"   {i*0.5:.1f}s - state: {data['state']}, is_speaking: {data['is_speaking']}")
    if not data['is_speaking'] and i > 2:
        break

print("\nDone!")
