#!/usr/bin/env python3
import base64
import json
import mimetypes
import os
import subprocess
import sys
import time
import urllib.error
import urllib.request

BIN_DIR = subprocess.check_output(["swift", "build", "-c", "release", "--show-bin-path"], cwd="companion", text=True).strip()
BINARY = os.path.join(BIN_DIR, "WACompanion")
TEST_AUDIO = os.path.abspath(os.environ.get("TEST_AUDIO", "eval/test-audio.wav"))

if not os.path.isfile(BINARY):
    print(f"Error: {BINARY} does not exist. Run 'swift build -c release' first.")
    sys.exit(1)

if not os.path.isfile(TEST_AUDIO):
    print(f"Error: {TEST_AUDIO} not found.")
    sys.exit(1)

print("Starting WACompanion process...")
proc = subprocess.Popen([BINARY], stdout=subprocess.PIPE, stderr=subprocess.PIPE)

def cleanup():
    if proc.poll() is None:
        proc.terminate()
        try:
            proc.wait(timeout=3)
        except subprocess.TimeoutExpired:
            proc.kill()

try:
    print("Waiting for companion app HTTP server and Parakeet model load...")
    ready = False
    start_time = time.time()
    while time.time() - start_time < 35:
        try:
            req = urllib.request.Request("http://127.0.0.1:8765/health")
            with urllib.request.urlopen(req, timeout=1) as resp:
                data = json.loads(resp.read().decode())
                if data.get("ok") and data.get("ready"):
                    ready = True
                    print(f"Companion ready! Engine: {data.get('engine')}, Model: {data.get('model')}")
                    break
                else:
                    print(f"Server up, model still loading: {data}")
        except Exception:
            pass
        time.sleep(1)

    if not ready:
        print("FAIL: Companion did not report ready within 35s.")
        cleanup()
        sys.exit(1)

    print("\nTest 1: Origin security check (evil.com -> 403 Forbidden)")
    evil_req = urllib.request.Request(
        "http://127.0.0.1:8765/health",
        headers={"Origin": "https://evil.com"}
    )
    try:
        with urllib.request.urlopen(evil_req, timeout=2) as resp:
            print("FAIL: Expected 403 Forbidden for untrusted origin, got:", resp.status)
            cleanup()
            sys.exit(1)
    except urllib.error.HTTPError as e:
        if e.code == 403:
            print("PASS: Untrusted origin blocked with 403 Forbidden.")
        else:
            print(f"FAIL: Expected 403, got {e.code}")
            cleanup()
            sys.exit(1)

    print("\nTest 2: Transcribe WhatsApp voice note via JSON base64")
    with open(TEST_AUDIO, "rb") as f:
        audio_bytes = f.read()
    b64 = base64.b64encode(audio_bytes).decode("ascii")

    payload = json.dumps({
        "audioBase64": b64,
        "mimeType": mimetypes.guess_type(TEST_AUDIO)[0] or "audio/wav",
        "language": "es"
    }).encode("utf-8")

    trans_req = urllib.request.Request(
        "http://127.0.0.1:8765/transcribe",
        data=payload,
        headers={
            "Content-Type": "application/json",
            "Origin": "chrome-extension://abcdefghijklmnop"
        }
    )

    t0 = time.time()
    with urllib.request.urlopen(trans_req, timeout=10) as resp:
        res = json.loads(resp.read().decode())
    elapsed_ms = int((time.time() - t0) * 1000)

    print(f"Response ({elapsed_ms} ms roundtrip):")
    print(json.dumps(res, indent=2, ensure_ascii=False))

    if not res.get("ok"):
        print("FAIL: Transcribe response ok != True")
        cleanup()
        sys.exit(1)

    expected_part = os.environ.get("EXPECTED_TEXT", "")
    if not res.get("text", "").strip() or expected_part.lower() not in res.get("text", "").lower():
        print(f"FAIL: Expected text to contain '{expected_part}', got: {res.get('text')}")
        cleanup()
        sys.exit(1)

    print("PASS: Transcription matches reference audio!")
    print(f"Engine: {res.get('engine')} | Transcribe time: {res.get('transcribeMs')} ms")

    print("\nAll integration tests passed successfully!")

finally:
    cleanup()
