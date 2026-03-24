"""Test script for TTS module with threading"""
import time
from tts import TTSEngine, TTSState

print("Creating TTS engine...")
engine = TTSEngine()

print(f"Initial state: {engine.state}")

text = "Hello, this is a test of the Kiosk Scholar text to speech system. It should speak for several seconds."

print(f"Starting speech...")
result = engine.speak(text)
print(f"speak() returned: {result}")

# Check state over time
for i in range(20):
    time.sleep(0.5)
    print(f"  {i*0.5:.1f}s - State: {engine.state}, is_speaking: {engine.is_speaking}")
    if not engine.is_speaking and i > 2:
        print("  Speech appears to have ended")
        break

print(f"Final state: {engine.state}")
print("Done!")
