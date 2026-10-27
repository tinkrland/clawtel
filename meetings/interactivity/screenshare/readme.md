# screenshare

sharing out from a spawnable. this is the rail with the most verified groundwork and the clearest gap list.

## what is verified

- getdisplaymedia inside a spawnable returns a real monitor capture: headed chrome on an xvfb display, 1920x1080 at 30fps, actual frame bytes pulled from the stream, when launched with the auto-select flag (bypasses the human picker, the agent-drive path)
- the https requirement is real: media devices do not exist on insecure pages

## the gap list (honest)

1. **share-out**: the join tab must live in the spawnable's own browser (not a headless remote browser, which has no desktop to share), and the share call becomes entire-screen capture with the auto-select flag. small variant of the platform share seam.
2. **actuation**: native apps cannot be driven by css selectors. an x input seam (key and pointer at the display level) is genuinely new code. browser content inside the spawnable keeps the dom rails.
3. **ingest**: compositing a spawnable's display into the agent's own stream reuses the existing pixel pipeline shape (grab rgba, feed the compositor), that part is close to existing rails.

web demos stay on dom rails and need none of this. desktop demos need all three.
