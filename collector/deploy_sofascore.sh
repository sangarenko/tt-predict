#!/bin/bash
# Deploy and test SofaScore scanner on the server
# Run from the server: bash deploy_sofascore.sh

set -e

PROJECT_DIR="/var/www/tt-predict"
COLLECTOR_DIR="$PROJECT_DIR/collector"
LOG_DIR="$PROJECT_DIR/logs"

echo "=== Deploying SofaScore Scanner ==="

# Ensure directories exist
mkdir -p "$LOG_DIR"
mkdir -p "$COLLECTOR_DIR"

# Copy scanner to server (if running locally, use scp)
echo "Scanner file location: $COLLECTOR_DIR/sofascore_scanner.py"

# Test Playwright is available
echo "Checking Playwright..."
python3 -c "from playwright.sync_api import sync_playwright; print('Playwright OK')" 2>/dev/null || {
    echo "Installing Playwright..."
    pip install playwright 2>/dev/null || pip3 install playwright 2>/dev/null
    python3 -m playwright install chromium
}

# Run in demo mode first (just fetch and display events)
echo ""
echo "=== Running DEMO (fetching SofaScore events without DB updates) ==="
python3 "$COLLECTOR_DIR/sofascore_scanner.py" --demo --pages 2

echo ""
echo "=== Demo complete! ==="
echo "Next steps:"
echo "  1. Run with --dry-run to see matches: python3 $COLLECTOR_DIR/sofascore_scanner.py --dry-run --pages 5"
echo "  2. Run for real: python3 $COLLECTOR_DIR/sofascore_scanner.py --pages 5"
echo "  3. Set up cron:  crontab -e → add line from cron_sofascore.sh"
