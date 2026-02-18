#!/usr/bin/env python3

import sys
import json
import subprocess

def send_message(message):
    """Send a JSON-encoded message to stdout with a 4-byte length header."""
    encoded = json.dumps(message).encode('utf-8')
    sys.stdout.buffer.write(len(encoded).to_bytes(4, byteorder='little'))
    sys.stdout.buffer.write(encoded)
    sys.stdout.flush()
    return

def read_message():
    """Read a JSON message from stdin (which starts with a 4-byte length)."""
    raw_length = sys.stdin.buffer.read(4)
    
    # return non if the msg is empty
    if not raw_length:
        return None
    
    message_length = int.from_bytes(raw_length, byteorder='little')
    message_data = sys.stdin.buffer.read(message_length)
    return json.loads(message_data)


def scan_jarm(target):
    
    # Run the threaded JARM command for better performance
    # Use 'python' for Windows, 'python3' for Linux/Mac
    python_cmd = 'python' if sys.platform == 'win32' else 'python3'
    result = subprocess.run(
        [python_cmd, 'threaded_jarm.py', target],
        capture_output=True, 
        text=True
    )
    
    if result.returncode != 0:
        return {'error': result.stderr.strip()}

    # Split the output by newlines to get each line
    lines = result.stdout.strip().split('\n')
    
    # Initialize the fields we expect to parse
    domain = None
    resolved_ip = None
    jarm_hash = None

    # Go through each line and parse the value after the colon
    for line in lines:
        line = line.strip()
        if line.lower().startswith('domain:'):
            domain = line.split(':', 1)[1].strip()
        elif line.lower().startswith('resolved ip:'):
            resolved_ip = line.split(':', 1)[1].strip()
        elif line.lower().startswith('jarm:'):
            jarm_hash = line.split(':', 1)[1].strip()
    
    return {
        'Domain': domain,
        'Resolved IP': resolved_ip,
        'JARM': jarm_hash
    }

def main():
    while True:
        incoming = read_message()
        
        if not incoming:
            break
        
        if 'target' not in incoming:
            send_message({'error': 'No target specified'})
            continue

        target = incoming['target']
        
        # Perform the JARM scan!
        response = scan_jarm(target)
        
        # send the response back to the extension
        send_message(response)



if __name__ == '__main__':
    main()
