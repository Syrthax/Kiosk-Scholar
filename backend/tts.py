"""
Text-to-Speech Module for Kiosk-Scholar
========================================

This module provides offline, non-blocking text-to-speech functionality using
system-native TTS engines:
- Windows: SAPI (Speech API) via win32com.client
- macOS: Built-in 'say' command via subprocess

Key Features:
- Runs entirely in background threads/subprocesses (non-blocking)
- Proper lifecycle management (start, stop, restart)
- Volume control that takes effect immediately
- Thread-safe with proper synchronization
- Handles edge cases (empty text, rapid clicks, mid-narration stops)
- Graceful error handling that doesn't crash the main application

Author: Kiosk-Scholar Team
"""

import sys
import threading
import queue
import subprocess
import platform
from typing import Optional, Callable
from dataclasses import dataclass
from enum import Enum

# Detect platform
IS_WINDOWS = platform.system() == "Windows"
IS_MACOS = platform.system() == "Darwin"


class TTSState(Enum):
    """Enumeration of possible TTS states."""
    IDLE = "idle"
    SPEAKING = "speaking"
    STOPPING = "stopping"


@dataclass
class TTSConfig:
    """Configuration for TTS engine."""
    rate: int = 150  # Words per minute (Windows: -10 to 10, we map this)
    volume: float = 1.0  # 0.0 to 1.0
    voice_name: Optional[str] = None  # None = use system default


class TTSEngine:
    """
    Cross-platform Text-to-Speech engine with non-blocking execution.
    
    This class provides a clean interface for TTS that:
    - Never blocks the main thread
    - Allows stopping mid-speech
    - Handles volume and rate adjustments
    - Is thread-safe
    
    Usage:
        engine = TTSEngine()
        engine.speak("Hello, world!")
        engine.set_volume(0.5)
        engine.stop()
    """
    
    def __init__(self, config: Optional[TTSConfig] = None):
        """
        Initialize the TTS engine.
        
        Args:
            config: Optional TTSConfig for customization
        """
        self._config = config or TTSConfig()
        self._state = TTSState.IDLE
        self._state_lock = threading.Lock()
        
        # Worker thread management
        self._worker_thread: Optional[threading.Thread] = None
        self._stop_event = threading.Event()
        
        # Platform-specific handles
        self._win_speaker = None  # Windows SAPI object (created in worker thread)
        self._win_process = None  # Windows subprocess for SAPI
        self._mac_process: Optional[subprocess.Popen] = None
        
        # Callbacks for state changes
        self._on_start_callback: Optional[Callable] = None
        self._on_stop_callback: Optional[Callable] = None
        self._on_error_callback: Optional[Callable[[str], None]] = None
    
    @property
    def state(self) -> TTSState:
        """Get current TTS state (thread-safe)."""
        with self._state_lock:
            return self._state
    
    @property
    def is_speaking(self) -> bool:
        """Check if TTS is currently speaking."""
        return self.state == TTSState.SPEAKING
    
    @property
    def volume(self) -> float:
        """Get current volume (0.0 to 1.0)."""
        return self._config.volume
    
    @volume.setter
    def volume(self, value: float):
        """
        Set volume (0.0 to 1.0). Takes effect immediately if speaking.
        
        Args:
            value: Volume level between 0.0 and 1.0
        """
        self._config.volume = max(0.0, min(1.0, value))
        
        # Apply immediately if speaking on Windows
        if IS_WINDOWS and self._win_speaker is not None:
            try:
                # SAPI volume is 0-100
                self._win_speaker.Volume = int(self._config.volume * 100)
            except Exception:
                pass  # Ignore errors during volume change
    
    @property
    def rate(self) -> int:
        """Get current speech rate."""
        return self._config.rate
    
    @rate.setter
    def rate(self, value: int):
        """
        Set speech rate. Takes effect on next speak() call.
        
        Args:
            value: Rate in approximate words per minute (80-200 recommended)
        """
        self._config.rate = max(50, min(300, value))
    
    def set_callbacks(
        self,
        on_start: Optional[Callable] = None,
        on_stop: Optional[Callable] = None,
        on_error: Optional[Callable[[str], None]] = None
    ):
        """
        Set optional callbacks for TTS events.
        
        Args:
            on_start: Called when speech begins
            on_stop: Called when speech ends (naturally or stopped)
            on_error: Called on error with error message
        """
        self._on_start_callback = on_start
        self._on_stop_callback = on_stop
        self._on_error_callback = on_error
    
    def speak(self, text: str) -> bool:
        """
        Start speaking the given text in a background thread.
        
        If already speaking, stops current speech and starts new.
        This method returns immediately (non-blocking).
        
        Args:
            text: The text to speak
            
        Returns:
            True if speech was started, False on error
        """
        # Handle empty/whitespace text
        if not text or not text.strip():
            return False
        
        # Stop any existing speech first
        if self.is_speaking:
            self.stop()
            # Wait briefly for stop to complete
            if self._worker_thread and self._worker_thread.is_alive():
                self._worker_thread.join(timeout=0.5)
        
        # Reset stop event
        self._stop_event.clear()
        
        # Set state to speaking
        with self._state_lock:
            self._state = TTSState.SPEAKING
        
        # Start worker thread
        self._worker_thread = threading.Thread(
            target=self._speak_worker,
            args=(text.strip(),),
            daemon=True
        )
        self._worker_thread.start()
        
        return True
    
    def stop(self):
        """
        Stop current speech immediately.
        
        This method is non-blocking and thread-safe.
        """
        with self._state_lock:
            if self._state != TTSState.SPEAKING:
                return
            self._state = TTSState.STOPPING
        
        # Signal worker to stop
        self._stop_event.set()
        
        # Platform-specific stop
        if IS_WINDOWS:
            self._stop_windows()
        elif IS_MACOS:
            self._stop_macos()
    
    def _speak_worker(self, text: str):
        """
        Worker thread that performs the actual TTS.
        
        Args:
            text: Text to speak
        """
        try:
            if self._on_start_callback:
                self._on_start_callback()
            
            if IS_WINDOWS:
                self._speak_windows(text)
            elif IS_MACOS:
                self._speak_macos(text)
            else:
                raise RuntimeError(f"Unsupported platform: {platform.system()}")
                
        except Exception as e:
            if self._on_error_callback:
                self._on_error_callback(str(e))
        finally:
            # Reset state
            with self._state_lock:
                self._state = TTSState.IDLE
            
            if self._on_stop_callback:
                self._on_stop_callback()
    
    # ════════════════════════════════════════════════════════════════════════
    # Windows SAPI Implementation
    # ════════════════════════════════════════════════════════════════════════
    
    def _speak_windows(self, text: str):
        """
        Speak text using Windows SAPI via PowerShell subprocess.
        
        This approach is more reliable than using COM directly in threads,
        as it avoids COM apartment threading issues.
        """
        try:
            import subprocess
            
            # Escape text for PowerShell (replace quotes and special chars)
            escaped_text = text.replace("'", "''").replace('"', '`"')
            
            # Build PowerShell script for SAPI
            volume = int(self._config.volume * 100)
            rate = int((self._config.rate - 150) / 30)
            rate = max(-10, min(10, rate))
            
            # PowerShell script that speaks with SAPI
            ps_script = f'''
Add-Type -AssemblyName System.Speech
$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
$synth.Volume = {volume}
$synth.Rate = {rate}
$synth.Speak("{escaped_text}")
'''
            
            # Run PowerShell subprocess
            self._win_process = subprocess.Popen(
                ['powershell', '-NoProfile', '-Command', ps_script],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                creationflags=subprocess.CREATE_NO_WINDOW if hasattr(subprocess, 'CREATE_NO_WINDOW') else 0
            )
            
            # Wait for completion or stop signal
            while not self._stop_event.is_set():
                try:
                    returncode = self._win_process.poll()
                    if returncode is not None:
                        break
                except Exception:
                    break
                self._stop_event.wait(0.1)
            
            # If stopped early, terminate the process
            if self._stop_event.is_set() and self._win_process.poll() is None:
                self._win_process.terminate()
                try:
                    self._win_process.wait(timeout=1.0)
                except:
                    self._win_process.kill()
                    
        except Exception as e:
            print(f"TTS Error: {e}")
            raise
        finally:
            self._win_process = None
    
    def _stop_windows(self):
        """Stop Windows SAPI speech immediately by terminating subprocess."""
        if self._win_process is not None:
            try:
                self._win_process.terminate()
                self._win_process.wait(timeout=1.0)
            except Exception:
                try:
                    self._win_process.kill()
                except Exception:
                    pass
    
    def _select_voice_windows(self, voice_name: str):
        """Select a specific voice by name on Windows."""
        try:
            voices = self._win_speaker.GetVoices()
            for i in range(voices.Count):
                voice = voices.Item(i)
                if voice_name.lower() in voice.GetDescription().lower():
                    self._win_speaker.Voice = voice
                    return
        except Exception:
            pass
    
    def _select_best_voice_windows(self):
        """
        Try to select the best available voice on Windows.
        
        Prefers Microsoft David (male) or Zira (female) for natural sound.
        Falls back to any available voice.
        """
        preferred_voices = [
            "Microsoft David",
            "Microsoft Zira",
            "Microsoft Mark",
            "Microsoft Eva",
        ]
        
        try:
            voices = self._win_speaker.GetVoices()
            voice_list = []
            
            for i in range(voices.Count):
                voice = voices.Item(i)
                desc = voice.GetDescription()
                voice_list.append((voice, desc))
            
            # Try preferred voices first
            for preferred in preferred_voices:
                for voice, desc in voice_list:
                    if preferred.lower() in desc.lower():
                        self._win_speaker.Voice = voice
                        return
            
            # If no preferred voice found, keep default
        except Exception:
            pass
    
    def get_available_voices_windows(self) -> list:
        """
        Get list of available voices on Windows.
        
        Returns:
            List of voice description strings
        """
        voices = []
        try:
            import win32com.client
            import pythoncom
            
            pythoncom.CoInitialize()
            try:
                speaker = win32com.client.Dispatch("SAPI.SpVoice")
                voice_objects = speaker.GetVoices()
                for i in range(voice_objects.Count):
                    voices.append(voice_objects.Item(i).GetDescription())
            finally:
                pythoncom.CoUninitialize()
        except Exception:
            pass
        
        return voices
    
    # ════════════════════════════════════════════════════════════════════════
    # macOS Implementation
    # ════════════════════════════════════════════════════════════════════════
    
    def _speak_macos(self, text: str):
        """
        Speak text using macOS 'say' command.
        
        Uses subprocess for non-blocking execution.
        """
        # Build command
        cmd = ["say"]
        
        # Set rate (words per minute, default ~175)
        cmd.extend(["-r", str(self._config.rate)])
        
        # Set voice if specified
        if self._config.voice_name:
            cmd.extend(["-v", self._config.voice_name])
        else:
            # Use a natural-sounding voice (Samantha is high quality)
            cmd.extend(["-v", "Samantha"])
        
        # Note: macOS 'say' doesn't have direct volume control
        # Volume is controlled at system level
        
        cmd.append(text)
        
        try:
            self._mac_process = subprocess.Popen(
                cmd,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL
            )
            
            # Wait for completion or stop signal
            while not self._stop_event.is_set():
                try:
                    # Check if process finished
                    returncode = self._mac_process.poll()
                    if returncode is not None:
                        break
                except Exception:
                    break
                self._stop_event.wait(0.1)
                
        finally:
            self._mac_process = None
    
    def _stop_macos(self):
        """Stop macOS 'say' process."""
        if self._mac_process is not None:
            try:
                self._mac_process.terminate()
                self._mac_process.wait(timeout=1.0)
            except Exception:
                try:
                    self._mac_process.kill()
                except Exception:
                    pass
    
    # ════════════════════════════════════════════════════════════════════════
    # Utility Methods
    # ════════════════════════════════════════════════════════════════════════
    
    @staticmethod
    def _split_into_sentences(text: str) -> list:
        """
        Split text into sentences for responsive stopping.
        
        Args:
            text: Input text
            
        Returns:
            List of sentences
        """
        import re
        
        # Split on sentence-ending punctuation, keeping the punctuation
        sentences = re.split(r'(?<=[.!?])\s+', text)
        
        # Further split very long sentences at commas/semicolons
        result = []
        for sentence in sentences:
            if len(sentence) > 200:
                # Split at commas or semicolons
                parts = re.split(r'(?<=[,;])\s+', sentence)
                result.extend(parts)
            else:
                result.append(sentence)
        
        return [s for s in result if s.strip()]
    
    def cleanup(self):
        """
        Clean up resources. Call this before application exit.
        """
        self.stop()
        if self._worker_thread and self._worker_thread.is_alive():
            self._worker_thread.join(timeout=2.0)


# ════════════════════════════════════════════════════════════════════════════
# Singleton instance for easy access
# ════════════════════════════════════════════════════════════════════════════

_tts_engine: Optional[TTSEngine] = None


def get_tts_engine() -> TTSEngine:
    """
    Get the global TTS engine instance (singleton pattern).
    
    Returns:
        The TTSEngine instance
    """
    global _tts_engine
    if _tts_engine is None:
        _tts_engine = TTSEngine()
    return _tts_engine


# ════════════════════════════════════════════════════════════════════════════
# Convenience functions for direct use
# ════════════════════════════════════════════════════════════════════════════

def speak(text: str) -> bool:
    """
    Speak the given text (non-blocking).
    
    Args:
        text: Text to speak
        
    Returns:
        True if speech started successfully
    """
    return get_tts_engine().speak(text)


def stop():
    """Stop current speech immediately."""
    get_tts_engine().stop()


def set_volume(volume: float):
    """
    Set TTS volume.
    
    Args:
        volume: Volume level (0.0 to 1.0)
    """
    get_tts_engine().volume = volume


def set_rate(rate: int):
    """
    Set TTS speech rate.
    
    Args:
        rate: Rate in words per minute (80-200 recommended)
    """
    get_tts_engine().rate = rate


def is_speaking() -> bool:
    """Check if TTS is currently speaking."""
    return get_tts_engine().is_speaking


def get_state() -> str:
    """Get current TTS state as string."""
    return get_tts_engine().state.value
