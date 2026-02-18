#!/usr/bin/env bash

# A simple installer for the JARM native messaging host on Linux (Chrome).
# - Copies 'native_host.py' and 'jarm.py' to /opt/jarm_app
# - Creates the manifest 'com.papou.jarm_scanner.json' in /etc/opt/chrome/native-messaging-hosts/

# Usage:
#   sudo ./install.sh <extension_id>


set -e  # Exit immediately if a command exits with a non-zero status.

# Get the extension ID from argument
EXTENSION_ID="$1"
if [ -z "$EXTENSION_ID" ]; then
  echo "Usage: ./install.sh <extension_id>"
  echo "Example: ./install.sh nggohbnjiabbnkkengnbmdbodgfkenok"
  exit 1
fi

echo "Installing JARM native messaging host for extension ID: $EXTENSION_ID"

# Move the Python scripts to /opt/jarm_app
INSTALL_DIR="/opt/jarm_app"
sudo mkdir -p "$INSTALL_DIR"

if [ ! -f "$HOME/Downloads/native_host.py" ] || [ ! -f "$HOME/Downloads/threaded_jarm.py" ] || [ ! -f "$HOME/Downloads/original_jarm.py" ]; then
  echo "Error: 'native_host.py', 'threaded_jarm.py', or 'original_jarm.py' not found in the current directory."
  exit 1
fi

sudo mv "$HOME/Downloads/native_host.py" "$HOME/Downloads/threaded_jarm.py" "$HOME/Downloads/original_jarm.py" "$INSTALL_DIR"
sudo chmod +x "$INSTALL_DIR/native_host.py"  # Make the main script executable

echo "Moved python scripts to $INSTALL_DIR"

# Create the Native Messaging manifest file
# Install in /etc/opt/chrome/native-messaging-hosts/ for a system-wide install
MANIFEST_DIR="/etc/opt/chrome/native-messaging-hosts"
sudo mkdir -p "$MANIFEST_DIR"

MANIFEST_PATH="$MANIFEST_DIR/com.papou.jarm_scanner.json"
sudo touch "$MANIFEST_PATH"

# Write out the JSON manifest:
cat <<EOF | sudo tee "$MANIFEST_PATH" >/dev/null
{
  "name": "com.papou.jarm_scanner",
  "description": "JARM Scanner native messaging host",
  "path": "$INSTALL_DIR/native_host.py",
  "type": "stdio",
  "allowed_origins": [
    "chrome-extension://$EXTENSION_ID/"
  ]
}
EOF

# set executable permissions for the manifest
sudo chmod o+r "$MANIFEST_PATH"

echo "Created native messaging manifest at: $MANIFEST_PATH"
echo "Installation complete!"
