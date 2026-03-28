---
name: observe-stop
description: Stop the Claude Observe server Docker container.
user_invocable: true
---

# /observe stop

Stop the Claude Observe Docker container.

## Instructions

1. Run this command to stop and remove the container:
   ```bash
   docker stop claude-observe 2>/dev/null; docker rm claude-observe 2>/dev/null
   ```

2. If successful:
   - Tell the user: "Claude Observe server stopped. The dashboard is no longer available. It will auto-restart on your next Claude Code session."

3. If the container was not running:
   - Tell the user: "Claude Observe server was not running."
