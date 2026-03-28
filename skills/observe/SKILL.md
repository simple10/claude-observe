---
name: observe
description: Open the Claude Observe dashboard. Shows the URL and checks if the server is running.
user_invocable: true
---

# /observe

Check if the Claude Observe server is running and show the dashboard URL.

## Instructions

1. Run this command to check if the server is running:
   ```bash
   curl -sf http://127.0.0.1:4981/api/health
   ```

2. If the command succeeds (exit code 0):
   - Tell the user: "Claude Observe is running. Dashboard: http://localhost:4981"

3. If the command fails:
   - Tell the user: "Claude Observe server is not running. Check that Docker is running and restart Claude Code, or run `/observe status` for details."
